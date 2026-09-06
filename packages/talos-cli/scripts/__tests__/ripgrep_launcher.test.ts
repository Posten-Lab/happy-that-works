import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('ripgrep launcher with an unloadable native addon', () => {
    let fixture: string;
    let launcher: string;
    let binary: string;
    let searchFile: string;

    beforeEach(() => {
        fixture = mkdtempSync(join(tmpdir(), 'talos ripgrep fallback '));
        mkdirSync(join(fixture, 'scripts'));
        mkdirSync(join(fixture, 'tools', 'unpacked'), { recursive: true });
        launcher = join(fixture, 'scripts', 'ripgrep_launcher.cjs');
        copyFileSync(resolve(__dirname, '../ripgrep_launcher.cjs'), launcher);
        // Force the same native-load failure as an unsupported Node ABI on Windows.
        writeFileSync(join(fixture, 'tools', 'unpacked', 'ripgrep.node'), 'not a native addon');
        const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
        binary = join(fixture, 'tools', 'unpacked', binaryName);
        copyFileSync(resolve(__dirname, '../../tools/unpacked', binaryName), binary);
        searchFile = join(fixture, 'search fixture.txt');
        writeFileSync(searchFile, 'before\nneedle in packaged search\nafter\n');
    });

    afterEach(() => rmSync(fixture, { recursive: true, force: true }));

    function run(args: unknown) {
        // No PATH search tool is available; only the copied package is needed.
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
        const result = spawnSync(process.execPath, [launcher, JSON.stringify(args)], {
            cwd: fixture, env: { ...env, PATH: fixture }, encoding: 'utf8', timeout: 10000,
        });
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        return result;
    }

    it('uses the actual packaged binary and keeps fallback diagnostics out of matching output', () => {
        const result = run(['--no-heading', '--no-filename', '--color', 'never', 'needle', searchFile]);
        expect(result.status).toBe(0);
        expect(result.stdout.replaceAll('\r\n', '\n')).toBe('needle in packaged search\n');
        expect(result.stderr).toContain('Failed to load ripgrep native addon');
        expect(result.stderr).not.toContain('Using system ripgrep');
    });

    it('preserves no-match exit code 1 and empty stdout', () => {
        const result = run(['absent-pattern', searchFile]);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
    });

    it('preserves search error exit code 2', () => {
        const result = run(['[', searchFile]);
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('regex parse error');
    });

    it('keeps JSON search output parseable after native fallback', () => {
        const result = run(['--json', 'needle', searchFile]);
        expect(result.status).toBe(0);
        const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
        expect(events.find(event => event.type === 'match').data.lines.text).toBe('needle in packaged search\n');
    });

    it('fails when the shipped binary cannot spawn, without silently using a different search tool', () => {
        rmSync(binary);
        mkdirSync(binary); // Exists, but cannot execute on either Windows or Unix.
        const result = run(['needle', searchFile]);
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('Ripgrep error:');
        expect(result.stderr).not.toContain('Using system ripgrep');
    });

    it('rejects invalid argument shapes as errors, not successful empty searches', () => {
        const result = run({ pattern: 'needle' });
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('Expected an array of string arguments');
    });
});
