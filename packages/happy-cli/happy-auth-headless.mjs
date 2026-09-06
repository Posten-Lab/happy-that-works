// Headless replay of `happy auth login` — bypasses the Ink UI so it can run
// without a TTY. Writes credentials to $HAPPY_HOME_DIR/access.key in the
// same JSON shape as the CLI (see src/persistence.ts:262 writeCredentialsLegacy
// and :272 writeCredentialsDataKey).
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import tweetnacl from 'tweetnacl';
import axios from 'axios';

const SERVER = process.env.HAPPY_SERVER_URL || 'http://localhost:3005';
const HOME_DIR = process.env.HAPPY_HOME_DIR || path.join(process.env.HOME, '.happy');
const KEY_FILE = path.join(HOME_DIR, 'access.key');

function encodeBase64(u8) {
    return Buffer.from(u8).toString('base64');
}
function encodeBase64Url(u8) {
    return Buffer.from(u8).toString('base64url');
}
function decodeBase64(s) {
    return new Uint8Array(Buffer.from(s, 'base64'));
}

// Wire layout matches src/ui/auth.ts:234 decryptWithEphemeralKey exactly:
//   [32-byte ephemeral pubkey][24-byte nonce][ciphertext].
function decryptWithEphemeralKey(encrypted, ourSecretKey) {
    if (encrypted.length < 32 + 24) return null;
    const ephemeralPubKey = encrypted.slice(0, 32);
    const nonce = encrypted.slice(32, 32 + tweetnacl.box.nonceLength);
    const ct = encrypted.slice(32 + tweetnacl.box.nonceLength);
    return tweetnacl.box.open(ct, nonce, ephemeralPubKey, ourSecretKey);
}

async function main() {
    const secret = randomBytes(32);
    const keypair = tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(secret));
    const pubkeyB64 = encodeBase64(keypair.publicKey);
    const authUrl = `happy://terminal?${encodeBase64Url(keypair.publicKey)}`;

    // Register the auth request
    await axios.post(`${SERVER}/v1/auth/request`, {
        publicKey: pubkeyB64,
        supportsV2: true,
    }, { headers: { 'X-Happy-Client': 'cli/e2e-headless' } });

    console.log(`AUTH_URL: ${authUrl}`);
    console.log(`WAITING …`);

    // Poll until authorized
    const started = Date.now();
    while (Date.now() - started < 5 * 60 * 1000) {
        try {
            const res = await axios.post(`${SERVER}/v1/auth/request`, {
                publicKey: pubkeyB64,
                supportsV2: true,
            }, { headers: { 'X-Happy-Client': 'cli/e2e-headless' } });
            if (res.data.state === 'authorized') {
                const token = res.data.token;
                const encrypted = decodeBase64(res.data.response);
                const decrypted = decryptWithEphemeralKey(encrypted, keypair.secretKey);
                if (!decrypted) {
                    console.error('DECRYPT_FAILED');
                    process.exit(3);
                }
                if (!existsSync(HOME_DIR)) mkdirSync(HOME_DIR, { recursive: true });
                if (decrypted.length === 32) {
                    writeFileSync(KEY_FILE, JSON.stringify({
                        secret: encodeBase64(decrypted),
                        token,
                    }, null, 2));
                } else if (decrypted[0] === 0) {
                    const publicKey = decrypted.slice(1, 33);
                    const machineKey = new Uint8Array(randomBytes(32));
                    writeFileSync(KEY_FILE, JSON.stringify({
                        encryption: {
                            publicKey: encodeBase64(publicKey),
                            machineKey: encodeBase64(machineKey),
                        },
                        token,
                    }, null, 2));
                } else {
                    console.error(`DECRYPT_UNEXPECTED first_byte=${decrypted[0]}`);
                    process.exit(4);
                }
                console.log(`AUTH_DONE key=${KEY_FILE}`);
                return;
            }
        } catch (e) {
            console.error(`POLL_ERR ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    console.error('TIMEOUT');
    process.exit(2);
}

main().catch(e => {
    console.error(`ERR ${e.stack || e.message}`);
    process.exit(1);
});
