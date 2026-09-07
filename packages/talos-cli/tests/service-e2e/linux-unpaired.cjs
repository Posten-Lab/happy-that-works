/** Verify the exact packed install before pairing, in a second isolated home. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const home = process.env.TALOS_HOME_DIR;
assert.equal(home, '/home/talos/.talos-unpaired', 'This probe requires its disposable home');
const service = require('/home/talos/.local/lib/node_modules/talosapp/scripts/daemon-service.cjs');
const status = service.serviceStatus({ talosHome: home });
assert.equal(status.installed, true);
assert.equal(status.active, true);
assert.equal(fs.existsSync(path.join(home, 'access.key')), false);
assert.equal(fs.existsSync(path.join(home, 'daemon.state.json')), false, 'Unpaired service must wait without authenticating or opening coding sessions');
const paired = service.serviceStatus({ talosHome: '/home/talos/.talos' });
assert.equal(paired.active, true);
assert.notEqual(status.name, paired.name);
console.log(JSON.stringify({ check: 'global-npm-installed-before-pairing', manager: status.manager, service: status.name, separateHomePreserved: paired.name, noCredentials: true, noCodingSessionStarted: true }));
service.uninstallService({ talosHome: home });
assert.equal(service.serviceStatus({ talosHome: '/home/talos/.talos' }).active, true);
console.log(JSON.stringify({ check: 'isolated-unpaired-service-removed-without-affecting-paired-service', manager: status.manager }));
