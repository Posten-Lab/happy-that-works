const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function prepareImageContext(workspace, revision) {
    if (!/^[a-f0-9]{40}$/.test(revision || '')) throw Error('An exact Git revision is required');
    const root = fs.realpathSync(workspace);
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    if (git(['rev-parse', '--show-toplevel']) !== root) throw Error('Context must start at the checkout root');
    if (git(['rev-parse', 'HEAD']) !== revision) throw Error('Image revision differs from the verified checkout');
    if (git(['status', '--porcelain', '--untracked-files=no'])) throw Error('Tracked checkout changes must be committed before image build');

    // Kaniko can copy nested node_modules from a working directory despite
    // .dockerignore. Export the reviewed tree so test-install shims cannot enter.
    const directory = fs.mkdtempSync(path.join(root, '.api-image-context-'));
    const archive = `${directory}.tar`;
    try {
        git(['archive', '--format=tar', `--output=${archive}`, revision]);
        execFileSync('tar', ['-xf', archive, '-C', directory], { stdio: 'pipe' });
        return directory;
    } catch (error) {
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
    } finally {
        fs.rmSync(archive, { force: true });
    }
}

if (require.main === module) {
    try {
        if (process.argv.length !== 3) throw Error('Usage: prepare-image-context.cjs <exact-revision>');
        console.log(prepareImageContext(process.cwd(), process.argv[2]));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { prepareImageContext };
