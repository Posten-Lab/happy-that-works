import { describe, it, expect } from 'vitest';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { createSessionScanner } from './sessionScanner';
import { getProjectPath } from './path';
import { seedClaudeTaskList } from './sessionProtocolMapper';

/**
 * The resume path, end to end.
 *
 * Stands up the on-disk state a resumed session actually sees — a claude
 * project dir holding a transcript full of raw Task* calls — then constructs
 * the scanner the way runClaude does on resume (with the known session id) and
 * asserts the task list is rebuilt and published.
 */
const REAL_TRANSCRIPT = '/Users/ahmedposten/.claude/projects/-Users-ahmedposten-work-benjamins-v2/ba91de6b-50b5-40cc-a15b-9684295dce1b.jsonl';
const CLAUDE_SESSION_ID = 'ba91de6b-50b5-40cc-a15b-9684295dce1b';

describe('resume seeds the task list', () => {
    it('rebuilds and publishes the list from an existing transcript', async () => {
        if (!existsSync(REAL_TRANSCRIPT)) return; // machine-specific fixture

        const workingDirectory = join(tmpdir(), `resume-seed-${Date.now()}`);
        await mkdir(workingDirectory, { recursive: true });
        const projectDir = getProjectPath(workingDirectory);
        await mkdir(projectDir, { recursive: true });
        await copyFile(REAL_TRANSCRIPT, join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`));

        const state: any = { currentTurnId: null };
        const published: any[] = [];

        const scanner = await createSessionScanner({
            sessionId: CLAUDE_SESSION_ID,
            workingDirectory,
            onMessage: () => {},
            onExistingEntries: (messages) => {
                published.push(...seedClaudeTaskList(state, messages as any));
            },
        });

        const end = published.find((e: any) => e.ev.t === 'tool-call-end') as any;
        const todos = end?.ev?.result?.newTodos ?? [];

        // eslint-disable-next-line no-console
        console.log(`published=${published.length} recovered=${todos.length}`);
        for (const t of todos.slice(0, 4)) console.log(`   [${t.status}] ${String(t.content).slice(0, 46)}`);

        expect(published.length).toBe(2);
        expect(todos.length).toBe(12);
        expect(todos[0]).toEqual({ content: 'Phase 0 — Plan + design spec + approval', status: 'completed' });

        await scanner.cleanup();
        await rm(workingDirectory, { recursive: true, force: true });
        await rm(projectDir, { recursive: true, force: true });
    }, 60000);
});

describe('seeded envelopes always carry a turn', () => {
    it('mints one when no turn is active, or the client drops them', async () => {
        const { seedClaudeTaskList } = await import('./sessionProtocolMapper');
        const state: any = { currentTurnId: null };
        const envelopes = seedClaudeTaskList(state, [
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'TaskCreate', input: { subject: 'x' } }] } } as any,
            { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'Task #1 created successfully: x' }] } } as any,
        ]);
        expect(envelopes).toHaveLength(2);
        for (const e of envelopes as any[]) {
            expect(typeof e.turn).toBe('string');
            expect(e.turn.length).toBeGreaterThan(0);
        }
    });
});
