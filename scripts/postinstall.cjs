const { execSync } = require('child_process');

// Apply patches to node_modules
require('../patches/fix-pglite-prisma-bytes.cjs');
require('../patches/fix-livekit-room-reuse.cjs');
require('../patches/expose-pierre-diffs-style.cjs');
require('../patches/force-preact-cjs.cjs');
require('../patches/fix-pierre-trees-preact-hooks.cjs');

if (process.env.SKIP_TALOS_WIRE_BUILD === '1') {
  console.log('[postinstall] SKIP_TALOS_WIRE_BUILD=1, skipping @talos/wire build');
  process.exit(0);
}

execSync('pnpm --filter @talos/wire build', {
  stdio: 'inherit',
});
