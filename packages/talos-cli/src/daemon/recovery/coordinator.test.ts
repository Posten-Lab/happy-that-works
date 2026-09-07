import { describe, expect, it, vi } from 'vitest';
import { SessionRecoveryCoordinator, type RecoveryLedgerEntry } from './coordinator';
import type { SessionCheckpoint } from './checkpoint';

const checkpoint = {
    version: 1, sessionId: 's', serverUrl: 'server', metadata: { path: '/project', host: 'host', homeDir: '/home/test', talosHomeDir: '/home/test/.talos', talosLibDir: '/lib/talos', talosToolsDir: '/lib/talos/tools', machineId: 'machine' },
    encryption: { encryptionKey: 'key', encryptionVariant: 'dataKey', seq: 0, metadataVersion: 0, agentStateVersion: 0 },
    pid: 42, processIdentity: 'birth', instanceId: 'runtime', desiredState: 'running', updatedAt: 0,
} satisfies SessionCheckpoint;

function fixture() {
    let records: SessionCheckpoint[] = [{ ...checkpoint }];
    let now = 0;
    const deps = {
        read: () => records, isAlive: vi.fn(() => false),
        resume: vi.fn(async (_record: SessionCheckpoint) => ({ type: 'success' } as { type: string; errorMessage?: string })),
        enabled: vi.fn(() => true), ready: vi.fn(() => true), serverUrl: 'server', machineId: 'machine', now: () => now,
    };
    return { deps, coordinator: new SessionRecoveryCoordinator(deps), records: (value: SessionCheckpoint[]) => { records = value; }, advance: (ms: number) => { now += ms; } };
}

describe('automatic session recovery', () => {
    it('restores the same checkpoint and reports success', async () => {
        const f = fixture();
        await f.coordinator.tick();
        expect(f.deps.resume).toHaveBeenCalledWith(checkpoint);
        expect(f.coordinator.getState().sessions[0]).toMatchObject({ sessionId: 's', status: 'restored', attempts: 1 });
    });

    it('never spawns duplicate live processes or sessions from another account/server', async () => {
        const f = fixture();
        f.deps.isAlive.mockReturnValue(true);
        await f.coordinator.tick();
        f.deps.isAlive.mockReturnValue(false);
        f.records([{ ...checkpoint, serverUrl: 'other' }, { ...checkpoint, metadata: { ...checkpoint.metadata, machineId: 'other' } }]);
        await f.coordinator.tick();
        expect(f.deps.resume).not.toHaveBeenCalled();
    });

    it('waits for network and honors disabled or stopped sessions', async () => {
        const f = fixture();
        f.deps.ready.mockReturnValue(false);
        await f.coordinator.tick();
        f.deps.ready.mockReturnValue(true);
        f.deps.enabled.mockReturnValue(false);
        await f.coordinator.tick();
        f.deps.enabled.mockReturnValue(true);
        f.records([{ ...checkpoint, desiredState: 'stopped' }]);
        await f.coordinator.tick();
        expect(f.deps.resume).not.toHaveBeenCalled();
    });

    it('serializes overlapping reconciliation and stops launching during shutdown', async () => {
        const f = fixture();
        let finish!: (value: { type: string }) => void;
        f.deps.resume.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const first = f.coordinator.tick();
        await f.coordinator.tick();
        expect(f.deps.resume).toHaveBeenCalledTimes(1);
        expect(f.coordinator.getState().sessions[0].status).toBe('restoring');
        f.coordinator.stop();
        finish({ type: 'success' });
        await first;
        await f.coordinator.tick();
        expect(f.deps.resume).toHaveBeenCalledTimes(1);
    });

    it('bounds automatic retries and exposes failures instead of a crash loop', async () => {
        const f = fixture();
        f.deps.resume.mockResolvedValue({ type: 'error', errorMessage: 'Project directory is missing' });
        await f.coordinator.tick();
        await f.coordinator.tick();
        expect(f.deps.resume).toHaveBeenCalledTimes(1);
        f.advance(2000);
        await f.coordinator.tick();
        f.advance(10_000);
        await f.coordinator.tick();
        f.advance(60_000);
        await f.coordinator.tick();
        expect(f.deps.resume).toHaveBeenCalledTimes(3);
        expect(f.coordinator.getState().sessions[0]).toMatchObject({ status: 'failed', error: 'Project directory is missing' });
    });

    it('rechecks stop intent immediately before a spawn', async () => {
        const f = fixture();
        let reads = 0;
        f.deps.read = () => [{ ...checkpoint, desiredState: reads++ ? 'stopped' : 'running' }];
        await f.coordinator.tick();
        expect(f.deps.resume).not.toHaveBeenCalled();
    });

    it('retains the retry budget across daemon restarts and reports post-spawn crashes as failed', async () => {
        const f = fixture();
        let ledger: RecoveryLedgerEntry[] = [];
        const persisted = { ...f.deps, load: () => structuredClone(ledger), save: (entries: RecoveryLedgerEntry[]) => { ledger = structuredClone(entries); } };
        for (const delay of [0, 2000, 10_000]) {
            f.advance(delay);
            const daemon = new SessionRecoveryCoordinator(persisted);
            await daemon.tick();
        }
        f.advance(600_000);
        const restarted = new SessionRecoveryCoordinator(persisted);
        await restarted.tick();
        expect(f.deps.resume).toHaveBeenCalledTimes(3);
        expect(restarted.getState().sessions[0]).toMatchObject({ status: 'failed', attempts: 3 });
    });

    it('persists an in-flight claim before spawning and waits through daemon replacement', async () => {
        const f = fixture();
        let ledger: RecoveryLedgerEntry[] = [];
        const persisted = { ...f.deps, load: () => structuredClone(ledger), save: (entries: RecoveryLedgerEntry[]) => { ledger = structuredClone(entries); } };
        let finish!: (result: { type: string }) => void;
        f.deps.resume.mockImplementation(async () => {
            expect(ledger[0]).toMatchObject({ status: 'restoring', attempts: 1, retryAt: 30_000 });
            return new Promise(resolve => { finish = resolve; });
        });
        const pending = new SessionRecoveryCoordinator(persisted).tick();
        await new SessionRecoveryCoordinator(persisted).tick();
        expect(f.deps.resume).toHaveBeenCalledTimes(1);
        finish({ type: 'success' });
        await pending;
    });

    it('resets retry budget only after observing a restored runtime stay alive', async () => {
        const f = fixture();
        await f.coordinator.tick();
        f.deps.isAlive.mockReturnValue(true);
        await f.coordinator.tick();
        f.advance(60_000);
        await f.coordinator.tick();
        expect(f.coordinator.getState().sessions[0].attempts).toBe(0);
        f.deps.isAlive.mockReturnValue(false);
        await f.coordinator.tick();
        expect(f.coordinator.getState().sessions[0]).toMatchObject({ status: 'restored', attempts: 1 });
    });

    it('does not spawn if durable retry state cannot be saved', async () => {
        const f = fixture();
        const coordinator = new SessionRecoveryCoordinator({ ...f.deps, save: () => { throw new Error('Disk unavailable'); } });
        await expect(coordinator.tick()).rejects.toThrow('Disk unavailable');
        await coordinator.tick();
        expect(f.deps.resume).not.toHaveBeenCalled();
        expect(coordinator.getState().sessions[0].status).toBe('failed');
    });
});
