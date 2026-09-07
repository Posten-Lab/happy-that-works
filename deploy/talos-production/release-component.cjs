#!/usr/bin/env node
// Release only an existing Talos Deployment. Datastores, Services and secrets
// are outside this command's mutation scope.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');

const components = {
    api: { deployment: 'talos-api', repository: 'ahmadposten/talos-server', origin: 'https://api.talosapp.ai' },
    web: { deployment: 'talos-web', repository: 'ahmadposten/talos-web', origin: 'https://talosapp.ai' },
};
const namespace = 'happy'; // Existing shared infrastructure; never recreate it.
const clone = value => JSON.parse(JSON.stringify(value));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function configFor(component, image, revision) {
    const config = components[component];
    if (!config) throw Error('Component must be api or web.');
    if (!/^[a-f0-9]{40}$/.test(revision || '')) throw Error('An exact Git commit SHA is required.');
    if (!new RegExp(`^${config.repository}@sha256:[a-f0-9]{64}$`).test(image || '')) {
        throw Error('The component image must use its Talos repository and an immutable sha256 digest.');
    }
    return config;
}

function validateDeployment(resource, config) {
    if (resource.kind !== 'Deployment' || resource.metadata?.namespace !== namespace ||
        resource.metadata?.name !== config.deployment || !resource.metadata.resourceVersion ||
        resource.spec?.selector?.matchLabels?.app !== config.deployment ||
        resource.spec?.selector?.matchLabels?.product !== 'talos') {
        throw Error('Deployment identity does not match the existing Talos component.');
    }
    const containers = resource.spec.template?.spec?.containers;
    if (containers?.length !== 1 || containers[0].name !== config.deployment ||
        !containers[0].image?.startsWith(`${config.repository}@sha256:`)) {
        throw Error('Expected one existing Talos container with a digest-pinned image.');
    }
    // Receipts may be archived. Refuse deployments containing inline secrets.
    for (const container of [...containers, ...(resource.spec.template.spec.initContainers || [])]) {
        for (const item of container.env || []) {
            if (item.value && (/secret|token|password|credential|private.?key|access.?key/i.test(item.name) ||
                /:\/\/[^/\s]*@|-----BEGIN .*PRIVATE KEY-----/.test(item.value))) {
                throw Error('Inline credentials must be moved to a Secret reference before release.');
            }
        }
    }
    if (config.deployment === 'talos-api' &&
        !containers[0].envFrom?.some(item => item.secretRef?.name === 'happy-server-secret')) {
        throw Error('The existing account/encryption secret reference must be preserved.');
    }
    return resource;
}

function desiredTemplate(current, config, image, revision) {
    validateDeployment(current, config);
    const template = clone(current.spec.template);
    template.metadata.annotations = { ...template.metadata.annotations, 'talosapp.ai/git-sha': revision };
    const container = template.spec.containers[0];
    container.image = image;
    container.env = (container.env || []).filter(item => item.name !== 'GIT_SHA');
    container.env.push({ name: 'GIT_SHA', value: revision });
    return template;
}

function command(args, timeout = 30_000) {
    return execFileSync('kubectl', args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
}

async function publicHealth(config, revision) {
    const get = async suffix => {
        const response = await fetch(config.origin + suffix, {
            signal: AbortSignal.timeout(10_000), redirect: 'error', cache: 'no-store',
        });
        if (!response.ok) throw Error(`Public health returned HTTP ${response.status}.`);
        return response;
    };
    if (config.deployment === 'talos-api') {
        await get('/health');
        const status = await (await get('/v1/status')).json();
        if (status.service !== 'talos' || status.protocol !== 1 || (revision && status.revision !== revision)) {
            throw Error('The public API did not return the expected Talos revision.');
        }
    } else {
        const html = await (await get('/')).text();
        if (!/<title>Talos<\/title>/.test(html)) throw Error('The public web page has the wrong identity.');
        if (revision) {
            const build = await (await get(`/talos-build.json?revision=${revision}`)).json();
            if (build.revision !== revision) throw Error('The public web revision does not match the release.');
        }
    }
}

function write(directory, file, data) {
    const target = path.join(directory, file);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
}

async function release({ component, image, revision, directory, recover = false }, dependencies = {}) {
    const run = dependencies.run || command;
    const health = dependencies.health || publicHealth;
    const sleep = dependencies.sleep || pause;
    const config = configFor(component, image, revision);
    const get = () => validateDeployment(JSON.parse(run(['-n', namespace, 'get', 'deployment', config.deployment, '-o', 'json'])), config);
    const replace = (current, template) => JSON.parse(run(['-n', namespace, 'patch', 'deployment', config.deployment,
        '--type=json', '-p', JSON.stringify([
            { op: 'test', path: '/metadata/resourceVersion', value: current.metadata.resourceVersion },
            { op: 'test', path: '/spec/template', value: current.spec.template },
            { op: 'replace', path: '/spec/template', value: template },
        ]), '-o', 'json']));
    // API replicas roll sequentially; observed cold image pulls exceed six minutes
    // on one node. Allow both pulls/startups before declaring a healthy rollout failed.
    const rolloutSeconds = component === 'api' ? 900 : 480;
    const rollout = () => run(['-n', namespace, 'rollout', 'status', `deployment/${config.deployment}`, `--timeout=${rolloutSeconds}s`], (rolloutSeconds + 20) * 1000);
    const check = async wantedRevision => {
        let last;
        for (let attempt = 0; attempt < 12; attempt++) {
            try { await health(config, wantedRevision); return; }
            catch (error) { last = error; if (attempt < 11) await sleep(5_000); }
        }
        throw last;
    };
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const statePath = path.join(directory, 'release.json');
    let before, expected, receipt;
    if (recover) {
        if (!fs.existsSync(statePath)) return { status: 'not-started' };
        receipt = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (receipt.component !== component || receipt.image !== image || receipt.revision !== revision) throw Error('Receipt identity mismatch.');
        if (receipt.status !== 'pending') return receipt;
        before = JSON.parse(fs.readFileSync(path.join(directory, 'previous.json'), 'utf8'));
        expected = JSON.parse(fs.readFileSync(path.join(directory, 'expected-template.json'), 'utf8'));
        validateDeployment(before, config);
    } else {
        if (fs.existsSync(statePath)) throw Error('Use a fresh release receipt directory.');
        before = get();
        expected = desiredTemplate(before, config, image, revision);
        receipt = { component, namespace, deployment: config.deployment, image, revision, previousImage: before.spec.template.spec.containers[0].image, status: 'pending' };
        // Persist before writing the cluster, including for Jenkins interruption recovery.
        write(directory, 'previous.json', { apiVersion: before.apiVersion, kind: before.kind,
            metadata: { name: before.metadata.name, namespace, resourceVersion: before.metadata.resourceVersion }, spec: before.spec });
        write(directory, 'expected-template.json', expected);
        write(directory, 'release.json', receipt);
    }
    const rollback = async () => {
        const current = get();
        const oldRevision = before.spec.template.spec.containers[0].env?.find(item => item.name === 'GIT_SHA')?.value;
        if (isDeepStrictEqual(current.spec.template, before.spec.template)) {
            // A previous recovery may have patched the old template and then
            // been interrupted before that ReplicaSet became ready.
            rollout();
            await check(oldRevision);
            receipt.status = 'unchanged'; write(directory, 'release.json', receipt); return;
        }
        if (!isDeepStrictEqual(current.spec.template, expected)) {
            receipt.status = 'rollback-refused'; write(directory, 'release.json', receipt);
            throw Error('Another operator changed the component; refusing to overwrite their deployment.');
        }
        replace(current, before.spec.template);
        rollout();
        await check(oldRevision);
        receipt.status = 'rolled-back'; write(directory, 'release.json', receipt);
    };
    if (recover) { await rollback(); return receipt; }
    try {
        const changed = replace(before, expected);
        // Capture any API-server defaults before using the concurrency guard.
        expected = changed.spec.template;
        write(directory, 'expected-template.json', expected);
        rollout();
        const current = get();
        if (!isDeepStrictEqual(current.spec.template, expected)) throw Error('Deployment changed during rollout.');
        await check(revision);
        receipt.status = 'deployed'; write(directory, 'release.json', receipt);
        return receipt;
    } catch (error) {
        try { await rollback(); }
        catch (rollbackError) { throw Error(`${error.message}; recovery: ${rollbackError.message}`); }
        throw Error(`${error.message}; previous Talos component restored or unchanged.`);
    }
}

if (require.main === module) {
    const [component, image, revision, directory, flag] = process.argv.slice(2);
    if (!directory || (flag && flag !== '--recover')) throw Error('Usage: release-component.cjs api|web IMAGE SHA RECEIPT_DIRECTORY [--recover]');
    release({ component, image, revision, directory, recover: flag === '--recover' })
        .then(result => console.log(JSON.stringify(result)))
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { release, components, configFor, validateDeployment, desiredTemplate, publicHealth };
