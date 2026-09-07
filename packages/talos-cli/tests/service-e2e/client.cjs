/** Real relay client for isolated, legacy-encrypted seeded E2E accounts. Never logs credentials. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const nacl = require('tweetnacl');
const { io } = require('socket.io-client');

async function createClient({ serverUrl, home }) {
  const credentials = JSON.parse(fs.readFileSync(path.join(home, 'access.key'), 'utf8'));
  if (!credentials.secret) throw new Error('This harness requires a disposable legacy-encrypted seeded account');
  const key = Buffer.from(credentials.secret, 'base64');
  function encrypt(value) {
    const nonce = nacl.randomBytes(24);
    const body = nacl.secretbox(Buffer.from(JSON.stringify(value)), nonce, key);
    return Buffer.concat([Buffer.from(nonce), Buffer.from(body)]).toString('base64');
  }
  function decrypt(value) {
    const body = Buffer.from(value, 'base64');
    const plain = nacl.secretbox.open(body.subarray(24), body.subarray(0, 24), key);
    if (!plain) throw new Error('Could not decrypt test record');
    return JSON.parse(Buffer.from(plain).toString());
  }
  async function request(url, init = {}) {
    const result = await fetch(`${serverUrl}${url}`, {
      ...init, headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new Error(`Test API ${url}: HTTP ${result.status}`);
    return result.json();
  }
  const socket = io(serverUrl, { path: '/v1/updates', transports: ['websocket'], auth: { token: credentials.token }, reconnection: false });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return {
    request, encrypt, decrypt,
    async rpc(machineId, method, params) {
      const result = await socket.timeout(30000).emitWithAck('rpc-call', { method: `${machineId}:${method}`, params: encrypt(params) });
      if (!result.ok) throw new Error(`Test RPC ${method}: ${result.error}`);
      const decoded = decrypt(result.result);
      if (decoded.error) throw new Error(`Test RPC ${method}: ${decoded.error}`);
      return decoded;
    },
    async send(sessionId, text, meta = {}) {
      return request(`/v3/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify({ messages: [{
        localId: randomUUID(), content: encrypt({ role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'web', ...meta } }),
      }] }) });
    },
    async messages(sessionId) {
      const result = await request(`/v3/sessions/${sessionId}/messages?after_seq=0&limit=100`);
      return result.messages.map(m => ({ seq: m.seq, body: decrypt(m.content.c) }));
    },
    close() { socket.close(); },
  };
}
module.exports = { createClient };
