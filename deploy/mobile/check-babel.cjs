// Run from packages/happy-app with the same isolated install used by EAS.
// Metro's cached export can otherwise hide a missing preset until Xcode bundles.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const appRequire = createRequire(resolve('package.json'));
const babel = appRequire('@babel/core');
const options = {
  filename: resolve('index.ts'),
  envName: 'production',
  caller: { name: 'metro', platform: 'ios', supportsStaticESM: true },
};
const config = babel.loadPartialConfig(options);
if (!config?.hasFilesystemConfig()) throw Error('App Babel config was not loaded');
babel.transformSync('export const ready: boolean = true;', options);
console.log('Production iOS Babel config and transform passed');
