import { describe, expect, it } from 'vitest';
import { calculateCost } from './pricing';

describe('calculateCost', () => {
    it('uses Opus 5 pricing for the full model ID', () => {
        expect(calculateCost({
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
        }, 'claude-opus-5')).toEqual({
            total: 30,
            input: 5,
            output: 25,
        });
    });

    it('uses Opus 5 pricing for the latest Opus alias', () => {
        expect(calculateCost({
            input_tokens: 1_000_000,
            output_tokens: 0,
        }, 'opus').total).toBe(5);
    });
});
