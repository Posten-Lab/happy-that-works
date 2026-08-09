import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    daemonEnvironment,
    sanitizeLifecyclePath,
}: {
    daemonEnvironment: (source: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
    sanitizeLifecyclePath: (value: string) => string;
} = require('./install-local.cjs');

describe('install-local daemon environment', () => {
    it('removes npm lifecycle bin directories without removing the normal CLI path', () => {
        const value = [
            '/repo/packages/happy-cli/node_modules/.bin',
            '/repo/node_modules/.bin',
            '/pnpm/node-gyp-bin',
            '/opt/homebrew/bin',
            '/global/codex-path',
        ].join(path.delimiter);

        expect(sanitizeLifecyclePath(value).split(path.delimiter)).toEqual([
            '/opt/homebrew/bin',
            '/global/codex-path',
        ]);
    });

    it('preserves the source environment while replacing PATH', () => {
        const source = {
            PATH: ['/repo/node_modules/.bin', '/opt/homebrew/bin'].join(path.delimiter),
            HAPPY_HOME_DIR: '/tmp/happy',
        };

        expect(daemonEnvironment(source)).toEqual({
            PATH: '/opt/homebrew/bin',
            HAPPY_HOME_DIR: '/tmp/happy',
        });
        expect(source.PATH).toContain('node_modules/.bin');
    });
});
