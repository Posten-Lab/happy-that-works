/** Run inside the disposable Linux containers; uses the real relay and providers. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('./client.cjs');

const home = process.env.TALOS_HOME_DIR || '/home/talos/.talos';
const evidence = process.env.TALOS_E2E_RESULTS || '/artifacts/linux-results.json';
const serverUrl = process.env.TALOS_SERVER_URL || 'http://127.0.0.1:56877';
const packageRoot = process.env.TALOS_E2E_PACKAGE || '/home/talos/.local/lib/node_modules/talosapp';
const service = require(path.join(packageRoot, 'scripts/daemon-service.cjs'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(description, check, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`Timed out: ${description}`);
}

async function daemon() {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(home, 'daemon.state.json'), 'utf8'));
    const response = await fetch(`http://127.0.0.1:${state.httpPort}/list`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    return { ...state, children: (await response.json()).children };
  } catch { return null; }
}

function checkpoint(sessionId) {
  const folder = path.join(home, 'session-recovery');
  if (!fs.existsSync(folder)) return null;
  for (const file of fs.readdirSync(folder).filter(file => /^[a-f0-9]{64}\.json$/.test(file))) {
    const value = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
    if (value.sessionId === sessionId) {
      try {
        const intent = JSON.parse(fs.readFileSync(path.join(folder, `${file}.stopped`), 'utf8'));
        if (intent.instanceId === value.instanceId) value.desiredState = 'stopped';
      } catch {}
      return value;
    }
  }
  return null;
}

async function reply(client, sessionId, marker) {
  // Repeated runs must observe a new response, never an earlier matching reply.
  marker = `${marker}_${randomUUID().slice(0, 8)}`;
  await client.send(sessionId, `Reply with exactly ${marker}. Do not run tools or change files.`);
  await waitFor(`real provider reply ${marker}`, async () => {
    const messages = await client.messages(sessionId);
    return messages.some(message => message.body.role === 'session' && message.body.content?.role === 'agent'
      && message.body.content?.ev?.t === 'text' && message.body.content.ev.text.trim() === marker);
  }, 150000);
  console.log(`Provider replied: ${marker}`);
  return marker;
}

async function verifyContext(client, session) {
  const previous = await client.messages(session.sessionId);
  const afterSeq = Math.max(0, ...previous.map(message => message.seq));
  const expected = session.firstMarker || `TALOS_LINUX_${session.provider.toUpperCase()}_READY`;
  await client.send(session.sessionId, 'Without using tools, reply with the exact marker you returned in your very first assistant reply in this conversation. Return only that original marker.');
  await waitFor('provider remembers its pre-reboot conversation', async () => {
    const messages = await client.messages(session.sessionId);
    return messages.some(message => message.seq > afterSeq && message.body.role === 'session' && message.body.content?.role === 'agent'
      && message.body.content?.ev?.t === 'text' && message.body.content.ev.text.trim() === expected);
  }, 150000);
  console.log(JSON.stringify({ check: 'provider-recalled-original-context', provider: session.provider, sessionId: session.sessionId, originalMarker: expected }));
}

async function main() {
  const mode = process.argv[2] || 'status';
  const status = await waitFor('OS starts installed service', () => {
    const current = service.serviceStatus({ talosHome: home });
    return current.active ? current : null;
  });
  assert.equal(status.installed, true, 'npm installation must install OS startup');
  assert.equal(status.active, true, 'OS supervisor must be running');
  console.log(JSON.stringify({ check: 'installed-service', ...status }));
  const ready = await waitFor('daemon connects without starting a terminal coding session', daemon);
  console.log(JSON.stringify({ check: 'daemon-ready', pid: ready.pid, children: ready.children }));
  if (mode === 'status') return;
  const machineId = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')).machineId;
  const client = await createClient({ home, serverUrl });
  try {
    if (mode === 'prepare') {
      const sessions = [];
      const providers = (process.env.TALOS_E2E_PROVIDERS || 'claude,codex').split(',');
      for (const provider of providers) {
        const result = await client.rpc(machineId, 'spawn-happy-session', { directory: '/home/talos/project', agent: provider });
        assert.equal(result.type, 'success');
        console.log(JSON.stringify({ check: 'ui-rpc-spawn', provider, sessionId: result.sessionId }));
        const firstMarker = await reply(client, result.sessionId, `TALOS_LINUX_${provider.toUpperCase()}_READY`);
        const saved = await waitFor('durable provider checkpoint', () => {
          const saved = checkpoint(result.sessionId);
          return saved && (saved.metadata.claudeSessionId || saved.metadata.codexThreadId) ? saved : null;
        });
        sessions.push({ provider, firstMarker, sessionId: result.sessionId, pid: saved.pid, claudeSessionId: saved.metadata.claudeSessionId, codexThreadId: saved.metadata.codexThreadId });
      }
      const before = await daemon();
      fs.writeFileSync(evidence, JSON.stringify({ manager: status.manager, machineId, originalDaemonPid: before.pid, sessions }, null, 2));
      process.kill(before.pid, 'SIGKILL');
      const after = await waitFor('supervisor restart after SIGKILL', async () => {
        const state = await daemon();
        return state && state.pid !== before.pid && state.children.length === sessions.length ? state : null;
      });
      for (const session of sessions) {
        assert.equal(after.children.filter(child => child.talosSessionId === session.sessionId).length, 1);
        assert.equal(after.children.find(child => child.talosSessionId === session.sessionId).pid, session.pid, 'daemon-only crash must adopt surviving process');
        await reply(client, session.sessionId, `TALOS_LINUX_${session.provider.toUpperCase()}_AFTER_DAEMON_CRASH`);
      }
      console.log(JSON.stringify({ check: 'daemon-crash-reconciled', oldPid: before.pid, newPid: after.pid, sessions }));
    } else if (mode === 'crash-existing') {
      const prior = JSON.parse(fs.readFileSync(evidence, 'utf8'));
      const before = await daemon();
      process.kill(before.pid, 'SIGKILL');
      const after = await waitFor('final supervisor crash recovery', async () => {
        const state = await daemon();
        return state && state.pid !== before.pid && state.children.length === before.children.length ? state : null;
      });
      for (const session of prior.sessions) {
        const previousChild = before.children.find(child => child.talosSessionId === session.sessionId);
        assert.equal(after.children.filter(child => child.talosSessionId === session.sessionId).length, 1);
        assert.equal(after.children.find(child => child.talosSessionId === session.sessionId).pid, previousChild.pid);
        await reply(client, session.sessionId, `TALOS_LINUX_${session.provider.toUpperCase()}_FINAL_DAEMON_CRASH`);
      }
      console.log(JSON.stringify({ check: 'final-daemon-crash-adopted-existing-processes', manager: status.manager, oldPid: before.pid, newPid: after.pid, children: after.children }));
    } else if (mode === 'verify-context') {
      const prior = JSON.parse(fs.readFileSync(evidence, 'utf8'));
      for (const session of prior.sessions) await verifyContext(client, session);
    } else if (mode === 'pause-daemon') {
      await client.rpc(machineId, 'stop-daemon', {});
      await waitFor('app stop persists daemon pause', () => {
        try { return JSON.parse(fs.readFileSync(path.join(home, 'service-preferences.json'), 'utf8')).paused === true; } catch { return false; }
      });
      await waitFor('app stop removes daemon control availability', async () => !(await daemon()));
      for (let attempt = 0; attempt < 20; attempt++) {
        assert.equal(await daemon(), null, 'supervisor must not bring an intentionally paused daemon back online');
        await sleep(500);
      }
      console.log(JSON.stringify({ check: 'app-stopped-daemon-stayed-offline', manager: status.manager }));
    } else if (mode === 'stop') {
      const prior = JSON.parse(fs.readFileSync(evidence, 'utf8'));
      for (const session of prior.sessions) {
        await client.rpc(machineId, 'stop-session', { sessionId: session.sessionId });
        await waitFor('intentional stop is durably recorded', () => checkpoint(session.sessionId)?.desiredState === 'stopped');
      }
      await waitFor('all requested sessions stop', async () => (await daemon())?.children.length === 0);
      console.log(JSON.stringify({ check: 'intentional-stops-persisted', sessions: prior.sessions.map(session => session.sessionId) }));
    } else if (mode === 'after-stop-reboot') {
      const prior = JSON.parse(fs.readFileSync(evidence, 'utf8'));
      // Let several recovery scans run, checking that no stopped child returns.
      for (let attempt = 0; attempt < 16; attempt++) {
        const current = await daemon();
        assert.equal(current.children.length, 0, 'intentionally stopped sessions must stay stopped');
        for (const session of prior.sessions) assert.equal(checkpoint(session.sessionId)?.desiredState, 'stopped');
        await sleep(500);
      }
      console.log(JSON.stringify({ check: 'stopped-sessions-stayed-stopped-after-reboot', manager: status.manager }));
    } else if (mode === 'after-reboot') {
      const prior = JSON.parse(fs.readFileSync(evidence, 'utf8'));
      const restored = await waitFor('sessions restored after container reboot', async () => {
        const state = await daemon();
        return state && prior.sessions.every(session => state.children.some(child => child.talosSessionId === session.sessionId)) ? state : null;
      }, 150000);
      for (const session of prior.sessions) {
        const saved = checkpoint(session.sessionId);
        assert.equal(restored.children.filter(child => child.talosSessionId === session.sessionId).length, 1);
        assert.equal(saved.metadata.claudeSessionId, session.claudeSessionId);
        assert.equal(saved.metadata.codexThreadId, session.codexThreadId);
        await reply(client, session.sessionId, `TALOS_LINUX_${session.provider.toUpperCase()}_AFTER_REBOOT`);
        await verifyContext(client, session);
      }
      console.log(JSON.stringify({ check: 'reboot-restored-same-sessions-and-provider-threads', manager: status.manager, sessions: prior.sessions.map(session => ({ provider: session.provider, sessionId: session.sessionId })) }));
    } else throw new Error(`Unknown mode: ${mode}`);
  } finally { client.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
