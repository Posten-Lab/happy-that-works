const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync('eas.json', 'utf8'));
for (const key of ['EXPO_ASC_KEY_ID', 'EXPO_ASC_ISSUER_ID', 'EXPO_ASC_API_KEY_PATH']) {
  if (!process.env[key]) throw Error(`Missing ${key}`);
}
if (config.submit?.production?.ios?.ascAppId !== '6787151946') throw Error('The existing App Store app must be preserved.');
if (!/^\/tmp\/talos-asc-key\.[A-Za-z0-9]+$/.test(process.env.EXPO_ASC_API_KEY_PATH)) throw Error('Use a private temporary ASC key path.');
Object.assign(config.submit.production.ios, {
  ascApiKeyPath: process.env.EXPO_ASC_API_KEY_PATH,
  ascApiKeyId: process.env.EXPO_ASC_KEY_ID,
  ascApiKeyIssuerId: process.env.EXPO_ASC_ISSUER_ID,
});
fs.writeFileSync('eas.json', JSON.stringify(config, null, 2) + '\n');
