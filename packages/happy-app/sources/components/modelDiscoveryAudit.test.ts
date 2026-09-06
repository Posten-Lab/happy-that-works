import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
    });
}

describe('model discovery source audit', () => {
    it('keeps hardcoded model fallbacks behind the canonical resolver', () => {
        const sourcesRoot = join(import.meta.dirname, '..');
        const violations = sourceFiles(sourcesRoot)
            .filter((path) => !path.endsWith('modelModeOptions.ts'))
            .filter((path) => !path.includes('.test.') && !path.includes('.spec.'))
            .filter((path) => readFileSync(path, 'utf8').includes('getHardcodedModelModes'))
            .map((path) => path.slice(sourcesRoot.length + 1));

        expect(violations).toEqual([]);
    });
});
