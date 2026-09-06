#!/usr/bin/env node
// Operator verification only: GET account state, list local sessions, and make
// encrypted listDirectory RPCs. Never start, resume, adopt, or stop a session.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const endpoint = 'https://api.talosapp.ai';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function codecs(nacl) {
    return {
        encrypt(value, key, variant) {
            const plain = Buffer.from(JSON.stringify(value));
            if (variant === 'legacy') {
                const nonce = crypto.randomBytes(24);
                return Buffer.concat([nonce, Buffer.from(nacl.secretbox(plain, nonce, key))]);
            }
            const nonce = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
            return Buffer.concat([Buffer.from([0]), nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
        },
        decrypt(value, key, variant) {
            if (variant === 'legacy') {
                const plain = nacl.secretbox.open(value.subarray(24), value.subarray(0, 24), key);
                if (!plain) throw Error('RPC authentication failed.');
                return JSON.parse(Buffer.from(plain).toString());
            }
            if (value.length < 29 || value[0] !== 0) throw Error('Invalid encrypted response.');
            const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(1, 13));
            cipher.setAuthTag(value.subarray(-16));
            return JSON.parse(Buffer.concat([cipher.update(value.subarray(13, -16)), cipher.final()]).toString());
        },
    };
}

async function verify(packageDirectory, connected) {
    const directory = fs.realpathSync(packageDirectory);
    const requirePackage = createRequire(path.join(directory, 'package.json'));
    const { io } = requirePackage('socket.io-client');
    const codec = codecs(requirePackage('tweetnacl'));
    const home = os.homedir();
    const source = path.join(home, '.happy');
    const target = path.join(home, '.talos');
    const credentials = read(path.join(source, 'access.key'));
    const original = read(path.join(source, 'settings.json'));
    const targetExists = fs.existsSync(path.join(target, 'access.key'));
    const targetSettings = targetExists ? read(path.join(target, 'settings.json')) : null;
    if (connected && !targetExists) throw Error('Talos account is not installed.');
    if (targetExists) {
        const imported = read(path.join(target, 'access.key'));
        if (JSON.stringify(imported) !== JSON.stringify(credentials) ||
            !targetSettings.machineId || targetSettings.machineId === original.machineId ||
            targetSettings.serverUrl !== endpoint || targetSettings.webappUrl !== 'https://talosapp.ai') {
            throw Error('Account, separate machine identity, or Talos endpoint check failed.');
        }
    }
    const variant = credentials.secret ? 'legacy' : 'dataKey';
    const machineKey = Buffer.from(credentials.secret || credentials.encryption.machineKey, 'base64');
    if (machineKey.length !== 32 || !credentials.token) throw Error('Incomplete account credentials.');
    const get = async suffix => {
        const response = await fetch(endpoint + suffix, { redirect: 'error', signal: AbortSignal.timeout(15_000),
            headers: { Authorization: `Bearer ${credentials.token}` } });
        if (!response.ok) throw Error('Authenticated account lookup failed.');
        return response.json();
    };
    const [machines, sessionResponse] = await Promise.all([get('/v1/machines'), get('/v1/sessions')]);
    if (!Array.isArray(machines) || !Array.isArray(sessionResponse.sessions)) throw Error('Invalid account response.');
    const oldMachine = machines.find(item => item.id === original.machineId);
    const newMachine = targetExists ? machines.find(item => item.id === targetSettings.machineId) : null;
    if (!oldMachine?.active || (connected && !newMachine?.active)) throw Error('Required machine is not online.');
    const localCount = async folder => {
        const state = read(path.join(folder, 'daemon.state.json'));
        if (!Number.isInteger(state.pid) || !Number.isInteger(state.httpPort)) throw Error('Invalid daemon state.');
        process.kill(state.pid, 0);
        const response = await fetch(`http://127.0.0.1:${state.httpPort}/list`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3_000),
        });
        if (!response.ok) throw Error('Local daemon did not answer.');
        const data = await response.json();
        if (!Array.isArray(data.children)) throw Error('Invalid local daemon response.');
        return { pid: state.pid, count: data.children.length };
    };
    const oldLocal = await localCount(source);
    const newLocal = connected ? await localCount(target) : null;
    if (newLocal && (newLocal.pid === oldLocal.pid || newLocal.count !== 0)) {
        throw Error('The new daemon must be separate and own no existing sessions at activation.');
    }
    const socket = io(endpoint, { path: '/v1/updates',
        auth: { token: credentials.token, clientType: 'user-scoped', talosClient: 'continuity-verification/1.0.0' },
        transports: ['websocket'], reconnection: false, timeout: 15_000 });
    try {
        await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
        const rpc = async (id, key, encryptionVariant) => {
            const response = await socket.timeout(15_000).emitWithAck('rpc-call', {
                method: `${id}:listDirectory`, params: codec.encrypt({ path: '..' }, key, encryptionVariant).toString('base64'),
            });
            if (!response.ok) throw Error('RPC routing failed.');
            const result = codec.decrypt(Buffer.from(response.result, 'base64'), key, encryptionVariant);
            // An enforced directory restriction proves the encrypted round trip
            // without reading any file. A directory listing is also read-only.
            if (result?.success !== true && !(result?.success === false && String(result.error).startsWith('Access denied:'))) {
                throw Error('Read-only RPC response was not recognized.');
            }
        };
        await rpc(original.machineId, machineKey, variant);
        if (connected) await rpc(targetSettings.machineId, machineKey, variant);
        const cache = read(path.join(source, 'sessions.json')).sessions;
        let activeSessionVerified = false;
        for (const session of sessionResponse.sessions.filter(item => item.active && cache[item.id]).slice(0, 8)) {
            const entry = cache[session.id];
            try {
                await rpc(session.id, Buffer.from(entry.encryptionKey, 'base64'), entry.encryptionVariant);
                activeSessionVerified = true; break;
            } catch { /* A stale active flag may refer to a disconnected client. */ }
        }
        if (!activeSessionVerified) throw Error('No original active session completed the read-only RPC check.');
        process.kill(oldLocal.pid, 0);
        if (newLocal) process.kill(newLocal.pid, 0);
        return { endpoint, accountAuthenticated: true, originalMachineOnline: true,
            talosAccountPresent: targetExists, distinctTalosMachineIdentity: !!targetSettings,
            talosMachineOnline: !!newMachine?.active, originalDaemonAlive: true,
            originalDaemonTrackedSessions: oldLocal.count, newDaemonTrackedSessions: newLocal?.count ?? null,
            originalMachineEncryptedRpc: true, newMachineEncryptedRpc: connected,
            originalActiveSessionEncryptedRpc: true, cachedSessionCount: Object.keys(cache).length,
            sessionControlRequests: 0 };
    } finally { socket.disconnect(); }
}

if (require.main === module) {
    const [packageDirectory, mode, ...extra] = process.argv.slice(2);
    if (!packageDirectory || !['--before', '--connected'].includes(mode) || extra.length) {
        console.error('Usage: verify-cli-continuity.cjs ABSOLUTE_PACKAGE_DIRECTORY --before|--connected'); process.exitCode = 1;
    } else {
        verify(packageDirectory, mode === '--connected').then(result => console.log(JSON.stringify(result, null, 2)))
            .catch(() => { console.error('Continuity verification failed; account details were intentionally not printed.'); process.exitCode = 1; });
    }
}
module.exports = { verify, codecs };
