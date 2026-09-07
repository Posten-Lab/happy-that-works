import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const config = vi.hoisted(() => ({ talosHomeDir: '', serverUrl: 'http://recovery.test' }));
const syncedTargets = vi.hoisted(() => [] as string[]);
vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, fsyncSync(fd: number) {
        syncedTargets.push(actual.fstatSync(fd).isDirectory() ? 'directory' : 'file');
        actual.fsyncSync(fd);
    } };
});
vi.mock('@/configuration', () => ({ configuration: config }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
import { checkpointSession, readSessionCheckpoint, readSessionCheckpoints, stopSessionRecovery, isCheckpointProcessAlive } from './checkpoint';

const input = {
    sessionId: 'session/../../escaped',
    metadata: { path: '/work/project', host: 'host', homeDir: '/home/test', talosHomeDir: '/home/test/.talos', talosLibDir: '/lib/talos', talosToolsDir: '/lib/talos/tools', machineId: 'machine', codexThreadId: 'thread' },
    encryption: { encryptionKey: 'private-session-key', encryptionVariant: 'dataKey' as const, seq: 12, metadataVersion: 4, agentStateVersion: 3 },
    model: 'selected-model', permissionMode: 'read-only',
};

describe('durable session checkpoints', () => {
    beforeEach(() => { syncedTargets.length = 0; config.talosHomeDir = mkdtempSync(join(tmpdir(), 'talos-checkpoint-')); });
    afterEach(() => rmSync(config.talosHomeDir, { recursive: true, force: true }));

    it('stores recovery data privately and identifies the actual live process', () => {
        checkpointSession(input);
        const saved = readSessionCheckpoint(input.sessionId)!;
        expect(saved).toMatchObject({ ...input, desiredState: 'running', pid: process.pid });
        expect(isCheckpointProcessAlive(saved)).toBe(true);
        expect(isCheckpointProcessAlive({ ...saved, processIdentity: 'another-boot' })).toBe(false);
        const dir = join(config.talosHomeDir, 'session-recovery');
        const files = readdirSync(dir);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
        expect(statSync(join(dir, files[0])).mode & 0o777).toBe(0o600);
    });

    it('cannot revive an explicitly stopped runtime, including a heartbeat already in flight', () => {
        checkpointSession(input);
        const dir = join(config.talosHomeDir, 'session-recovery');
        const file = join(dir, readdirSync(dir)[0]);
        const inFlight = readFileSync(file);
        stopSessionRecovery(input.sessionId);
        writeFileSync(file, inFlight); // Another process finishes a heartbeat after the stop marker.
        expect(readSessionCheckpoint(input.sessionId)?.desiredState).toBe('stopped');
        checkpointSession(input);
        expect(readSessionCheckpoints()[0].desiredState).toBe('stopped');
    });

    it('does not apply a previous runtime stop to a new manually resumed process', () => {
        checkpointSession(input);
        stopSessionRecovery(input.sessionId);
        const dir = join(config.talosHomeDir, 'session-recovery');
        const file = join(dir, readdirSync(dir).find(f => f.endsWith('.json'))!);
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(file, JSON.stringify({ ...saved, instanceId: 'new-process', desiredState: 'running' }));
        expect(readSessionCheckpoint(input.sessionId)?.desiredState).toBe('running');
    });

    it('retains running sessions beyond 14 days and ignores malformed neighboring records', () => {
        checkpointSession(input);
        const dir = join(config.talosHomeDir, 'session-recovery');
        const file = join(dir, readdirSync(dir)[0]);
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(file, JSON.stringify({ ...saved, updatedAt: 1 }));
        writeFileSync(join(dir, `${'a'.repeat(64)}.json`), '{');
        expect(readSessionCheckpoints()).toHaveLength(1);
        stopSessionRecovery(input.sessionId);
        expect(readSessionCheckpoints()).toHaveLength(0);
    });

    it.each(['{broken', 'null', '{}', '{"instanceId":123}'])('does not resume against a damaged stop marker: %s', content => {
        checkpointSession(input);
        const dir = join(config.talosHomeDir, 'session-recovery');
        const file = join(dir, readdirSync(dir)[0]);
        writeFileSync(`${file}.stopped`, content);
        expect(readSessionCheckpoint(input.sessionId)?.desiredState).toBe('stopped');
        expect(readSessionCheckpoints()[0].desiredState).toBe('stopped');
    });

    it('does not resume when an existing stop marker cannot be read as a file', () => {
        checkpointSession(input);
        const dir = join(config.talosHomeDir, 'session-recovery');
        mkdirSync(join(dir, `${readdirSync(dir)[0]}.stopped`));
        expect(readSessionCheckpoint(input.sessionId)?.desiredState).toBe('stopped');
    });

    it('syncs the checkpoint and stop-marker directory entries after syncing file contents', () => {
        checkpointSession(input);
        stopSessionRecovery(input.sessionId);
        expect(syncedTargets).toEqual(process.platform === 'win32'
            ? ['file', 'file'] : ['file', 'directory', 'file', 'directory']);
    });
});
