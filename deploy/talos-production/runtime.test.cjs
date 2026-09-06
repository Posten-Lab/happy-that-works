const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('production rendering updates only the four additive resources and retains existing state', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-runtime-render-'));
    try {
        const output = path.join(directory, 'rendered.json');
        const result = spawnSync(process.execPath, [path.join(__dirname, 'render.cjs'), output], {
            encoding: 'utf8',
            env: { ...process.env, TALOS_API_IMAGE: `ahmadposten/talos-server@sha256:${'a'.repeat(64)}`, TALOS_WEB_IMAGE: `ahmadposten/talos-web@sha256:${'b'.repeat(64)}` },
        });
        assert.equal(result.status, 0, result.stderr);
        const items = JSON.parse(fs.readFileSync(output, 'utf8')).items;
        assert.deepEqual(items.map((item) => `${item.kind}/${item.metadata.namespace}/${item.metadata.name}`).sort(), [
            'Deployment/happy/talos-api', 'Deployment/happy/talos-web', 'Service/happy/talos-api', 'Service/happy/talos-web',
        ]);
        const api = items.find((item) => item.kind === 'Deployment' && item.metadata.name === 'talos-api');
        const container = api.spec.template.spec.containers[0];
        assert.deepEqual(container.envFrom, [{ secretRef: { name: 'happy-server-secret' } }]);
        const env = Object.fromEntries(container.env.map(({ name, value }) => [name, value]));
        assert.equal(env.REDIS_URL, 'redis://happy-redis:6379');
        assert.equal(env.S3_BUCKET, 'happy');
        assert.equal(env.S3_HOST, 'files.talosapp.ai');
        assert.deepEqual(api.spec.template.spec.initContainers.map((item) => item.name), ['wait-postgres']);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('two replicas survive a single voluntary eviction and cannot share a host', () => {
    const workloads = JSON.parse(fs.readFileSync(path.join(__dirname, 'workloads.template.json'), 'utf8'));
    const budgets = JSON.parse(fs.readFileSync(path.join(__dirname, 'disruptions.json'), 'utf8'));
    assert.equal(budgets.items.length, 2);
    for (const deployment of workloads.items.filter((item) => item.kind === 'Deployment')) {
        const selector = deployment.spec.selector.matchLabels;
        const spec = deployment.spec.template.spec;
        const budget = budgets.items.find((item) => item.metadata.name === deployment.metadata.name);
        assert.equal(deployment.spec.replicas, 2);
        assert.equal(deployment.spec.strategy.rollingUpdate.maxUnavailable, 0);
        assert.equal(deployment.spec.minReadySeconds, 10);
        assert.equal(budget.metadata.namespace, 'happy');
        assert.equal(budget.spec.minAvailable, 1);
        assert.deepEqual(budget.spec.selector.matchLabels, selector);
        assert.deepEqual(spec.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution, [{
            labelSelector: { matchLabels: selector }, topologyKey: 'kubernetes.io/hostname',
        }]);
        assert.equal(spec.terminationGracePeriodSeconds, 60);
        assert.deepEqual(spec.containers[0].lifecycle.preStop.exec.command, ['sh', '-c', 'sleep 10']);
    }
});

test('API startup and readiness check dependencies while liveness checks only the process', () => {
    const { items } = JSON.parse(fs.readFileSync(path.join(__dirname, 'workloads.template.json'), 'utf8'));
    const { template } = items.find((item) => item.kind === 'Deployment' && item.metadata.name === 'talos-api').spec;
    const container = template.spec.containers[0];
    assert.equal(container.livenessProbe.httpGet.path, '/v1/status');
    assert.equal(container.readinessProbe.httpGet.path, '/health');
    assert.equal(container.startupProbe.httpGet.path, '/health');
    assert.equal(container.startupProbe.periodSeconds * container.startupProbe.failureThreshold, 300);
    assert.equal(template.metadata.annotations['prometheus.io/scrape'], 'true');
    assert.equal(template.metadata.annotations['prometheus.io/port'], '9090');
});
