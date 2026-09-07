import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDaemonShutdownController, type DaemonShutdownSource } from './shutdown';

afterEach(() => { vi.useRealTimers(); });

describe('managed daemon shutdown intent', () => {
    it.each(['talos-app', 'talos-cli'] as const)('persists %s stop before stalled cleanup reaches forced exit', async source => {
        vi.useFakeTimers();
        let paused = false;
        const forceExit = vi.fn(() => { expect(paused).toBe(true); });
        const controller = createDaemonShutdownController({
            managed: true, pauseService: () => { paused = true; }, onRequest: vi.fn(), forceExit,
        });
        // Model cleanup awaiting an acknowledgment that never arrives.
        void controller.resolvesWhenShutdownRequested.then(() => new Promise(() => {}));
        controller.requestShutdown(source);
        expect(paused).toBe(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(forceExit).toHaveBeenCalledOnce();
    });

    it.each(['os-signal', 'exception'] as const)('leaves automatic restart enabled after %s', async source => {
        vi.useFakeTimers();
        const pauseService = vi.fn();
        const forceExit = vi.fn();
        const controller = createDaemonShutdownController({ managed: true, pauseService, onRequest: vi.fn(), forceExit });
        controller.requestShutdown(source);
        await vi.advanceTimersByTimeAsync(1000);
        expect(pauseService).not.toHaveBeenCalled();
        expect(forceExit).toHaveBeenCalledOnce();
    });

    it('does not change service preferences for an unmanaged daemon', () => {
        vi.useFakeTimers();
        const pauseService = vi.fn();
        createDaemonShutdownController({ managed: false, pauseService, onRequest: vi.fn(), forceExit: vi.fn() })
            .requestShutdown('talos-cli');
        expect(pauseService).not.toHaveBeenCalled();
    });

    it('honors an explicit stop while an earlier signal is already shutting down', async () => {
        vi.useFakeTimers();
        const pauseService = vi.fn();
        const forceExit = vi.fn();
        const onRequest = vi.fn();
        const controller = createDaemonShutdownController({ managed: true, pauseService, onRequest, forceExit });
        for (const source of ['os-signal', 'talos-app'] as DaemonShutdownSource[]) controller.requestShutdown(source);
        expect(pauseService).toHaveBeenCalledOnce();
        expect(onRequest).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1000);
        expect(forceExit).toHaveBeenCalledOnce();
    });
});
