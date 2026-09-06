import { describe, expect, it } from 'vitest';
import { encryptionContexts } from '@ahmadposten/talos-wire';
import { deriveKey } from '@/utils/deriveKey';

/** Fixed vectors generated with the original implementation at the pre-rebrand checkpoint. */
describe('encryption continuity across the Talos rebrand', () => {
    const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
    it.each([
        [encryptionContexts.content, ['content'], '67eebf3ff0eb241774d2f6e45e4869ca3e01785630dae7635428076e725351be'],
        [encryptionContexts.blobs, ['master'], 'c1c73ca3c5c5e2d17a27b07881bb0bd5b2d373d68db37c53d8d270d1d96c6b52'],
        [encryptionContexts.blobs, ['session'], 'dc5e397289fd4e38c3a903fff58fa37329594492b9b2e996b3b069acc13e4c05'],
    ] as const)('preserves the %s / %j key', async (context, path, expected) => {
        expect(Buffer.from(await deriveKey(secret, context, [...path])).toString('hex')).toBe(expected);
    });
});
