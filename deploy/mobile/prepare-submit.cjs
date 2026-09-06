const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync('eas.json', 'utf8'));
for (const key of ['EXPO_ASC_KEY_ID', 'EXPO_ASC_ISSUER_ID']) {
  if (!process.env[key]) throw Error(`Missing ${key}`);
}
Object.assign(config.submit.production.ios, {
  ascApiKeyPath: '/tmp/asc-key.p8',
  ascApiKeyId: process.env.EXPO_ASC_KEY_ID,
  ascApiKeyIssuerId: process.env.EXPO_ASC_ISSUER_ID,
});
fs.writeFileSync('eas.json', JSON.stringify(config, null, 2) + '\n');
