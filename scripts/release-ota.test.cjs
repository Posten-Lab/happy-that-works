const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runOta } = require('./release-ota.cjs');

test('every OTA step receives its selected application identity and a literal message', () => {
    for (const profile of ['preview', 'production']) {
        const calls = [];
        const message = 'Talos release: "quoted" $HOME `literal`\nsecond line';
        assert.equal(runOta(profile, {
            env: { npm_execpath: '/tools/pnpm.cjs', APP_ENV: 'development', OTA_MESSAGE: message },
            run(command, args, options) { calls.push({ command, args, options }); return { status: 0 }; },
        }), 0);
        assert.equal(calls.length, 4);
        for (const call of calls) {
            assert.equal(call.options.env.APP_ENV, profile);
            assert.equal(call.options.env.NODE_ENV, 'production');
            assert.equal(call.options.shell, undefined);
        }
        const args = calls.at(-1).args;
        assert.equal(args[args.indexOf('--branch') + 1], profile);
        assert.equal(args[args.indexOf('--message') + 1], message);
    }
});

test('failed preflight or local verification prevents OTA publication', () => {
    for (const failureStep of [1, 2, 3]) {
        let calls = 0;
        assert.equal(runOta('production', {
            env: { npm_execpath: '/tools/pnpm.cjs' },
            run() { calls += 1; return { status: calls === failureStep ? 7 : 0 }; },
        }), 7);
        assert.equal(calls, failureStep);
    }
    assert.throws(() => runOta('development', { run() { throw new Error('Must not execute'); } }), /profile must/);
});
