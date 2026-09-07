/** Shared by npm postinstall and the CLI. No package dependencies or shell commands. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function xml(value) {
  return String(value).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]);
}

function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function unitQuote(value, command = false) {
  // systemd performs its own %-specifier and $-variable expansion after unquoting.
  return '"' + String(value).replace(/%/g, '%%').replace(/\$/g, () => command ? '$$' : '$').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

function createContext(options = {}) {
  const env = { ...(options.env || process.env) };
  const home = options.home || os.homedir();
  const talosHome = path.resolve(options.talosHome || (env.TALOS_HOME_DIR || path.join(home, '.talos')).replace(/^~(?=\/|$)/, home));
  const uid = options.uid ?? process.getuid?.() ?? -1;
  const id = crypto.createHash('sha256').update(`${uid}:${talosHome}`).digest('hex').slice(0, 16);
  const packageRoot = options.packageRoot || path.resolve(__dirname, '..');
  const node = options.node || process.execPath;
  const platform = options.platform || process.platform;
  const exists = options.exists || fs.existsSync;
  const manager = platform === 'darwin' ? 'launchd'
    : platform === 'linux' && exists('/run/systemd/system') ? 'systemd'
    : platform === 'linux' && exists('/sbin/openrc-run') ? 'openrc' : null;
  if (manager === 'systemd') {
    // npm/su invocations may have no PAM login environment even after lingering
    // starts the user manager. Point systemctl at this user's runtime bus.
    if (!env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    if (!env.DBUS_SESSION_BUS_ADDRESS) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
  }
  const name = manager === 'launchd' ? `ai.talos.daemon.${id}` : `talos-daemon-${id}`;
  const configHome = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  const serviceFile = manager === 'launchd' ? path.join(home, 'Library', 'LaunchAgents', `${name}.plist`)
    : manager === 'systemd' ? path.join(configHome, 'systemd', 'user', `${name}.service`)
    : manager === 'openrc' ? `/etc/init.d/${name}` : undefined;
  const entries = (env.PATH || '').split(path.delimiter).filter(entry => path.isAbsolute(entry) && !/\/(node_modules\/\.bin|node-gyp-bin)\/?$/.test(entry));
  const serviceEnv = {
    HOME: home,
    PATH: [...new Set([path.dirname(node), ...entries, path.join(home, '.local/bin'), path.join(home, '.cargo/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(path.delimiter),
    TALOS_HOME_DIR: talosHome,
    TALOS_SERVICE_MANAGED: '1',
  };
  // Do not serialize the caller's environment: provider API keys, npm tokens and
  // session credentials belong in their credential stores, never service files.
  for (const key of ['TALOS_SERVER_URL', 'TALOS_WEBAPP_URL']) {
    if (env[key]) {
      const url = new URL(env[key]);
      if (url.username || url.password || url.search || url.hash) throw new Error(`${key} must not contain credentials, a query or fragment for background service setup`);
      serviceEnv[key] = env[key];
    }
  }
  for (const key of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
    if (env[key]) serviceEnv[key] = path.resolve(env[key].replace(/^~(?=\/|$)/, home));
  }
  for (const key of ['LANG', 'LC_ALL', 'LC_CTYPE']) {
    if (env[key]) serviceEnv[key] = env[key];
  }
  return { env, home, talosHome, uid, name, node, packageRoot, manager, serviceFile, serviceEnv,
    command: [node, '--no-warnings', '--no-deprecation', path.join(packageRoot, 'bin', 'talos.mjs'), 'daemon', 'start-sync'],
    preferencesFile: path.join(talosHome, 'service-preferences.json'),
    run: options.run || ((command, args, extra = {}) => spawnSync(command, args, { encoding: 'utf8', timeout: 15000, env, ...extra })),
    exists, allowPrompt: options.allowPrompt ?? false,
    sleep: options.sleep || (ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)),
  };
}

function renderService(ctx) {
  if (ctx.manager === 'launchd') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(ctx.name)}</string>
<key>ProgramArguments</key><array>${ctx.command.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>EnvironmentVariables</key><dict>${Object.entries(ctx.serviceEnv).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>AbandonProcessGroup</key><true/>
<key>WorkingDirectory</key><string>${xml(ctx.home)}</string>
<key>StandardOutPath</key><string>${xml(path.join(ctx.talosHome, 'logs', 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(ctx.talosHome, 'logs', 'service.error.log'))}</string>
</dict></plist>
`;
  }
  if (ctx.manager === 'systemd') {
    // WorkingDirectory is a path directive, not a command-line directive: quotes
    // become literal path characters. Preserve spaces and escape specifiers.
    if (/[\r\n\0]/.test(ctx.home)) throw new Error('systemd background startup does not support control characters in the home directory');
    return `[Unit]
Description=Talos background service
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=${ctx.command.map(arg => unitQuote(arg, true)).join(' ')}
WorkingDirectory=${ctx.home.replace(/%/g, '%%')}
${Object.entries(ctx.serviceEnv).map(([key, value]) => `Environment=${unitQuote(`${key}=${value}`)}`).join('\n')}
Restart=always
RestartSec=5
KillMode=process
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=default.target
`;
  }
  if (ctx.manager === 'openrc') {
    // OpenRC evals command and arguments: quote each word for that second parse,
    // then quote the entire assignment for the initial script parse.
    return `#!/sbin/openrc-run
description='Talos background service'
supervisor=supervise-daemon
command=${shellQuote(shellQuote(ctx.command[0]))}
command_args_foreground=${shellQuote(ctx.command.slice(1).map(shellQuote).join(' '))}
command_user=${shellQuote(String(ctx.uid))}
directory=${shellQuote(shellQuote(ctx.home))}
pidfile=${shellQuote(`/run/${ctx.name}.pid`)}
respawn_delay=5
respawn_max=0
retry=SIGTERM/30/SIGKILL/5
umask=0077
supervise_daemon_args=${shellQuote(Object.entries(ctx.serviceEnv).map(([key, value]) => `--env ${shellQuote(`${key}=${value}`)}`).join(' '))}
depend() {
  use net
}
`;
  }
  throw new Error('No supported service manager found');
}

function preferences(ctx) {
  try { return JSON.parse(fs.readFileSync(ctx.preferencesFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`Cannot read background service preference: ${error.message}`); }
}

function savePreferences(ctx, values) {
  fs.mkdirSync(ctx.talosHome, { recursive: true, mode: 0o700 });
  const file = `${ctx.preferencesFile}.${process.pid}.tmp`;
  fs.writeFileSync(file, JSON.stringify({ ...preferences(ctx), ...values }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(file, ctx.preferencesFile);
}

function checkedResult(command, args, result) {
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : `: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`}`);
  return result.stdout?.trim() || '';
}

function run(ctx, command, args, options = {}) {
  return checkedResult(command, args, ctx.run(command, args, options));
}

function bootstrapAfterRemoval(ctx, args) {
  // bootout acknowledges the request before launchd has removed the old job.
  // During this window bootstrap returns EIO/EALREADY. Retry only this known
  // replacement race, and preserve any permanent failure for the user.
  const deadline = Date.now() + 5000;
  let result;
  for (let attempt = 0; attempt < 50; attempt++) {
    result = ctx.run('launchctl', args, { timeout: 1000 });
    if (result.status === 0 || ![5, 37].includes(result.status) || Date.now() >= deadline) break;
    ctx.sleep(100);
  }
  return checkedResult('launchctl', args, result);
}

function privileged(ctx, command, args) {
  return ctx.uid === 0 ? run(ctx, command, args) : run(ctx, 'sudo', [ctx.allowPrompt ? '--' : '-n', ...(ctx.allowPrompt ? [] : ['--']), command, ...args], ctx.allowPrompt ? { stdio: 'inherit' } : {});
}

function serviceStatus(options = {}) {
  const ctx = createContext(options);
  const enabled = preferences(ctx).enabled !== false && !['0', 'false', 'no'].includes(ctx.env.TALOS_AUTOSTART || '');
  const installed = Boolean(ctx.serviceFile && ctx.exists(ctx.serviceFile));
  let active = false;
  if (installed) {
    if (ctx.manager === 'launchd') active = ctx.run('launchctl', ['print', `gui/${ctx.uid}/${ctx.name}`]).status === 0;
    if (ctx.manager === 'systemd') active = ctx.run('systemctl', ['--user', 'is-active', `${ctx.name}.service`]).status === 0;
    if (ctx.manager === 'openrc') active = ctx.run('rc-service', [ctx.name, 'status']).status === 0;
  }
  return { manager: ctx.manager, enabled, installed, active, name: ctx.name, serviceFile: ctx.serviceFile };
}

function ensureService(options = {}) {
  const ctx = createContext(options);
  if (options.enable) savePreferences(ctx, { enabled: true });
  if (preferences(ctx).enabled === false || ['0', 'false', 'no'].includes(ctx.env.TALOS_AUTOSTART || '')) return { managed: false, reason: 'disabled' };
  if (ctx.uid === 0) return { managed: false, reason: 'deferred', message: 'Background service setup will complete when you run talos auth login as your ordinary user.' };
  if (!ctx.manager) return { managed: false, reason: 'unsupported', message: 'Automatic background startup requires macOS launchd or Linux systemd/OpenRC. Sessions remain available only while a daemon process is running.' };
  if (!ctx.exists(path.join(ctx.packageRoot, 'dist', 'index.mjs'))) return { managed: false, reason: 'deferred', message: 'Background service setup is waiting for the CLI build to complete.' };
  if (options.adoptExisting) {
    // npm can upgrade a previously detached daemon without an intervening auth
    // command. Stop it through the normal CLI so its sessions remain running.
    run(ctx, ctx.node, [...ctx.command.slice(1, -2), 'daemon', 'stop']);
  }
  savePreferences(ctx, { paused: false });
  fs.mkdirSync(path.join(ctx.talosHome, 'logs'), { recursive: true, mode: 0o700 });
  const content = renderService(ctx);
  const previous = ctx.exists(ctx.serviceFile) ? fs.readFileSync(ctx.serviceFile, 'utf8') : null;
  const changed = content !== previous;
  if (ctx.manager === 'openrc') {
    if (changed) {
      const staged = path.join(ctx.talosHome, `${ctx.name}.init`);
      fs.writeFileSync(staged, content, { mode: 0o600 });
      try { privileged(ctx, 'install', ['-o', 'root', '-g', 'root', '-m', '0755', staged, ctx.serviceFile]); }
      finally { fs.rmSync(staged, { force: true }); }
    }
    if (!ctx.exists(`/etc/runlevels/default/${ctx.name}`)) {
      privileged(ctx, 'rc-update', ['add', ctx.name, 'default']);
    }
    const active = ctx.run('rc-service', [ctx.name, 'status']).status === 0;
    if (changed && active || options.restart) privileged(ctx, 'rc-service', [ctx.name, 'restart']);
    else if (!active) privileged(ctx, 'rc-service', [ctx.name, 'start']);
  } else {
    if (changed) {
      fs.mkdirSync(path.dirname(ctx.serviceFile), { recursive: true, mode: 0o700 });
      const staging = `${ctx.serviceFile}.${process.pid}.tmp`;
      fs.writeFileSync(staging, content, { mode: 0o600 });
      fs.renameSync(staging, ctx.serviceFile);
    }
    if (ctx.manager === 'launchd') {
      // LaunchAgents must be bootstrapped into the GUI login domain so provider
      // authentication can access the user's login keychain and security session.
      if (ctx.run('launchctl', ['print', `gui/${ctx.uid}`]).status !== 0) return { managed: true, active: false, reason: 'login-required', message: 'Background service is installed and will start at your next macOS login.' };
      const target = `gui/${ctx.uid}/${ctx.name}`;
      const loaded = ctx.run('launchctl', ['print', target]).status === 0;
      if (loaded && changed) run(ctx, 'launchctl', ['bootout', target]);
      run(ctx, 'launchctl', ['enable', target]);
      if (loaded && changed) bootstrapAfterRemoval(ctx, ['bootstrap', `gui/${ctx.uid}`, ctx.serviceFile]);
      else if (!loaded) run(ctx, 'launchctl', ['bootstrap', `gui/${ctx.uid}`, ctx.serviceFile]);
      else if (options.restart) run(ctx, 'launchctl', ['kickstart', '-k', target]);
      else run(ctx, 'launchctl', ['kickstart', target]);
    } else {
      // Lingering starts the user's service manager at boot and keeps it through
      // logout. A user unit without linger does not fulfill automatic recovery.
      const linger = ctx.run('loginctl', ['show-user', String(ctx.uid), '--property=Linger', '--value']);
      if (linger.status !== 0 || linger.stdout?.trim() !== 'yes') {
        const enabled = ctx.run('loginctl', ['enable-linger', String(ctx.uid)]);
        if (enabled.status !== 0) privileged(ctx, 'loginctl', ['enable-linger', String(ctx.uid)]);
        // logind returns before the newly enabled user manager finishes starting.
        // Give its bus a bounded opportunity to become ready before unit setup.
        for (let attempt = 0; attempt < 30; attempt++) {
          if (ctx.run('systemctl', ['--user', 'show', '--property=Version', '--value'], { timeout: 250 }).status === 0) break;
          ctx.sleep(100);
        }
      }
      if (changed) run(ctx, 'systemctl', ['--user', 'daemon-reload']);
      run(ctx, 'systemctl', ['--user', 'enable', '--now', `${ctx.name}.service`]);
      if (changed && previous !== null || options.restart) run(ctx, 'systemctl', ['--user', 'restart', `${ctx.name}.service`]);
    }
  }
  savePreferences(ctx, { enabled: true });
  return { managed: true, active: true, restarted: changed || Boolean(options.restart), manager: ctx.manager, serviceFile: ctx.serviceFile };
}

function stopService(options = {}) {
  const ctx = createContext(options);
  if (!ctx.serviceFile || !ctx.exists(ctx.serviceFile)) return false;
  savePreferences(ctx, { paused: true });
  if (ctx.manager === 'launchd') {
    if (ctx.run('launchctl', ['print', `gui/${ctx.uid}/${ctx.name}`]).status === 0) run(ctx, 'launchctl', ['bootout', `gui/${ctx.uid}/${ctx.name}`]);
  } else if (ctx.manager === 'systemd') run(ctx, 'systemctl', ['--user', 'stop', `${ctx.name}.service`]);
  else {
    try { privileged(ctx, 'rc-service', [ctx.name, 'stop']); }
    catch {
      // OpenRC's system supervisor requires administrative authorization to stop.
      // The ordinary daemon HTTP shutdown still works; any supervisor restart
      // waits on the persisted pause until the user's next explicit start/login.
      return false;
    }
  }
  return true;
}

function pauseService(options = {}) { savePreferences(createContext(options), { paused: true }); }
function isServicePaused(options = {}) { return preferences(createContext(options)).paused === true; }

function uninstallService(options = {}) {
  const ctx = createContext(options);
  // Persist before removal so auth/normal CLI usage does not silently reinstall.
  savePreferences(ctx, { enabled: false });
  stopService(options);
  if (!ctx.serviceFile || !ctx.exists(ctx.serviceFile)) return;
  if (ctx.manager === 'systemd') run(ctx, 'systemctl', ['--user', 'disable', `${ctx.name}.service`]);
  if (ctx.manager === 'openrc') {
    privileged(ctx, 'rc-update', ['del', ctx.name, 'default']);
    privileged(ctx, 'rm', ['--', ctx.serviceFile]);
  } else fs.rmSync(ctx.serviceFile, { force: true });
  if (ctx.manager === 'systemd') run(ctx, 'systemctl', ['--user', 'daemon-reload']);
  // Never disable linger: other user services may depend on it.
}

function shouldInstallFromNpm(env = process.env, packageRoot = path.resolve(__dirname, '..')) {
  if (env.npm_config_global !== 'true' || env.CI || env.npm_command === 'link'
    || fs.existsSync(path.join(packageRoot, 'src')) || !fs.existsSync(path.join(packageRoot, 'dist', 'index.mjs'))) return false;

  // npm sets global=true for dependencies of globally installed packages too.
  // Only the direct global Talos package should register a persistent service.
  // Unknown layouts safely complete setup later during ordinary account login.
  const resolvedRoot = fs.realpathSync(packageRoot);
  const candidates = [];
  if (env.npm_config_prefix) {
    candidates.push(path.join(env.npm_config_prefix, 'lib/node_modules/talosapp'), path.join(env.npm_config_prefix, 'node_modules/talosapp'));
  }
  const normalized = resolvedRoot.replace(/\\/g, '/');
  const pnpmStore = normalized.indexOf('/node_modules/.pnpm/');
  if (pnpmStore !== -1) {
    // pnpm executes lifecycle scripts inside its virtual store. A direct global
    // install has a top-level link; transitive dependencies do not.
    candidates.push(path.join(normalized.slice(0, pnpmStore), 'node_modules/talosapp'));
  } else if (!env.npm_config_prefix && normalized.endsWith('/lib/node_modules/talosapp')
    && normalized.split('/node_modules/').length === 2) {
    candidates.push(resolvedRoot);
  }
  return candidates.some(candidate => {
    try { return fs.realpathSync(candidate) === resolvedRoot; } catch { return false; }
  });
}

module.exports = { createContext, renderService, ensureService, stopService, pauseService, isServicePaused, uninstallService, serviceStatus, shouldInstallFromNpm };

if (require.main === module) {
  try {
    if (process.argv[2] === 'postinstall' && shouldInstallFromNpm()) {
      const result = ensureService({ adoptExisting: true });
      if (result.message) console.log(`Talos: ${result.message}`);
    } else if (process.argv[2] === 'stop') stopService();
  } catch (error) {
    console.error(`Talos background service: ${error.message}. Setup will retry during talos auth login.`);
    // An unavailable service manager must not make npm uninstall the package.
    if (process.argv[2] !== 'postinstall') process.exitCode = 1;
  }
}
