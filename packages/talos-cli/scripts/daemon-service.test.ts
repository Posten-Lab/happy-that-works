import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const { createContext, renderService, ensureService, stopService, isServicePaused, pauseService, uninstallService, serviceStatus, shouldInstallFromNpm } = createRequire(import.meta.url)('./daemon-service.cjs')

describe('automatic daemon service', () => {
  let root: string
  let opts: Record<string, any>
  let loaded: boolean
  let lingering: boolean
  let run: ReturnType<typeof vi.fn>
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'talos-service-test-'))
    mkdirSync(join(root, 'package/dist'), { recursive: true })
    writeFileSync(join(root, 'package/dist/index.mjs'), '')
    loaded = false
    lingering = false
    run = vi.fn((command: string, args: string[]) => {
      if (command === 'launchctl') {
        if (args[0] === 'print') return { status: args[1] === 'gui/501' || loaded ? 0 : 113, stdout: '' }
        if (args[0] === 'bootstrap') loaded = true
        if (args[0] === 'bootout') loaded = false
      }
      if (command === 'loginctl' && args[0] === 'show-user') return { status: 0, stdout: lingering ? 'yes\n' : 'no\n' }
      if (command === 'loginctl' && args[0] === 'enable-linger') lingering = true
      return { status: 0, stdout: '' }
    })
    opts = { platform: 'darwin', home: root, talosHome: join(root, '.talos'), packageRoot: join(root, 'package'), node: '/test/node/bin/node', uid: 501,
      env: { PATH: '/tmp/node_modules/.bin:/custom/provider/bin:/usr/bin', SECRET_TOKEN: 'never serialize this', TALOS_SERVER_URL: 'https://example.test' }, run }
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('installs into the GUI login domain and is idempotent', () => {
    expect(ensureService(opts)).toMatchObject({ managed: true, manager: 'launchd' })
    const ctx = createContext(opts)
    expect(run).toHaveBeenCalledWith('launchctl', ['bootstrap', 'gui/501', ctx.serviceFile], {})
    expect(readFileSync(ctx.serviceFile, 'utf8')).toContain('<key>AbandonProcessGroup</key><true/>')
    run.mockClear()
    ensureService(opts)
    expect(run.mock.calls.some(([cmd, args]) => cmd === 'launchctl' && args[0] === 'bootout')).toBe(false)
    expect(run.mock.calls.some(([cmd, args]) => cmd === 'launchctl' && args[0] === 'bootstrap')).toBe(false)
  })

  it('replaces a changed installation and restarts it under launchd', () => {
    ensureService(opts)
    run.mockClear()
    ensureService({ ...opts, node: '/updated/node' })
    expect(run.mock.calls.filter(([cmd]) => cmd === 'launchctl').map(([, args]) => args[0])).toEqual(['print', 'print', 'bootout', 'enable', 'bootstrap'])
  })

  it('waits for launchd bootout to finish before bootstrapping an upgrade', () => {
    ensureService(opts)
    opts.sleep = vi.fn()
    let attempts = 0
    opts.run = vi.fn((command: string, args: string[]) => {
      if (command === 'launchctl' && args[0] === 'bootstrap' && ++attempts < 3) return { status: attempts === 1 ? 5 : 37, stderr: 'Removal in progress' }
      return run(command, args)
    })
    expect(ensureService({ ...opts, node: '/updated/node' })).toMatchObject({ managed: true })
    expect(attempts).toBe(3)
    expect(opts.sleep).toHaveBeenCalledTimes(2)
  })

  it('reports a launchd replacement failure after bounded retries', () => {
    ensureService(opts)
    opts.sleep = vi.fn()
    let attempts = 0
    opts.run = vi.fn((command: string, args: string[]) => {
      if (command === 'launchctl' && args[0] === 'bootstrap') { attempts++; return { status: 5, stderr: 'Input/output error' } }
      return run(command, args)
    })
    expect(() => ensureService({ ...opts, node: '/updated/node' })).toThrow('Input/output error')
    expect(attempts).toBe(50)
  })

  it('installs for next login when the macOS GUI domain is unavailable', () => {
    opts.run = vi.fn(() => ({ status: 113 }))
    expect(ensureService(opts)).toMatchObject({ managed: true, active: false, reason: 'login-required' })
    expect(existsSync(createContext(opts).serviceFile)).toBe(true)
    expect(opts.run).toHaveBeenCalledTimes(1)
  })

  it('isolates services by Talos data directory and does not export secrets or npm PATH', () => {
    const ctx = createContext(opts)
    expect(ctx.name).not.toBe(createContext({ ...opts, talosHome: join(root, 'other') }).name)
    const rendered = renderService(ctx)
    expect(rendered).not.toContain('SECRET_TOKEN')
    expect(rendered).not.toContain('never serialize this')
    expect(rendered).not.toContain('/tmp/node_modules/.bin')
    expect(rendered).toContain('/custom/provider/bin')
    expect(rendered).toContain('<key>TALOS_SERVICE_MANAGED</key><string>1</string>')
    expect(ctx.command).toEqual(['/test/node/bin/node', '--no-warnings', '--no-deprecation', join(root, 'package/bin/talos.mjs'), 'daemon', 'start-sync'])
  })

  it('escapes plist XML and prevents endpoint credentials being written to disk', () => {
    const rendered = renderService(createContext({ ...opts, node: '/tmp/<node>&"' }))
    expect(rendered).toContain('/tmp/&lt;node&gt;&amp;&quot;')
    expect(() => createContext({ ...opts, env: { TALOS_SERVER_URL: 'https://secret@example.test' } })).toThrow('must not contain credentials')
  })

  it('enables Linux lingering before starting a systemd user service', () => {
    opts.platform = 'linux'
    opts.exists = (file: string) => file === '/run/systemd/system' || existsSync(file)
    expect(ensureService(opts)).toMatchObject({ managed: true, manager: 'systemd' })
    const ctx = createContext(opts)
    expect(run.mock.calls.map(([cmd, args]) => [cmd, ...args])).toEqual([
      ['loginctl', 'show-user', '501', '--property=Linger', '--value'],
      ['loginctl', 'enable-linger', '501'],
      ['systemctl', '--user', 'show', '--property=Version', '--value'],
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'enable', '--now', `${ctx.name}.service`],
    ])
    expect(readFileSync(ctx.serviceFile, 'utf8')).toContain('KillMode=process')
    expect(readFileSync(ctx.serviceFile, 'utf8')).toContain('Restart=always')
    expect(readFileSync(ctx.serviceFile, 'utf8')).toContain(`WorkingDirectory=${root}\n`)
    run.mockClear()
    ensureService(opts)
    expect(run.mock.calls.map(([cmd, args]) => [cmd, ...args])).toEqual([
      ['loginctl', 'show-user', '501', '--property=Linger', '--value'],
      ['systemctl', '--user', 'enable', '--now', `${ctx.name}.service`],
    ])
  })

  it('discovers the user bus for npm and su invocations without a login environment', () => {
    opts.platform = 'linux'
    opts.exists = (file: string) => file === '/run/systemd/system' || existsSync(file)
    const context = createContext(opts)
    expect(context.env.XDG_RUNTIME_DIR).toBe('/run/user/501')
    expect(context.env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/501/bus')
    expect(opts.env.XDG_RUNTIME_DIR).toBeUndefined()
    const configured = createContext({ ...opts, env: { XDG_RUNTIME_DIR: '/user/runtime', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/user/custom-bus' } })
    expect(configured.env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/user/custom-bus')
  })

  it('waits for the newly lingering user manager to finish starting', () => {
    opts.platform = 'linux'
    opts.exists = (file: string) => file === '/run/systemd/system' || existsSync(file)
    opts.sleep = vi.fn()
    let probes = 0
    opts.run = vi.fn((command: string, args: string[]) => {
      if (command === 'systemctl' && args.includes('--property=Version')) return { status: ++probes < 3 ? 1 : 0 }
      return run(command, args)
    })
    expect(ensureService(opts)).toMatchObject({ managed: true })
    expect(opts.sleep).toHaveBeenCalledTimes(2)
  })

  it('reports denied Linux linger authorization instead of claiming reboot support', () => {
    opts.platform = 'linux'
    opts.exists = (file: string) => file === '/run/systemd/system' || existsSync(file)
    opts.run = vi.fn(() => ({ status: 1, stderr: 'permission denied' }))
    expect(() => ensureService(opts)).toThrow('permission denied')
    expect(opts.run.mock.calls.some(([cmd]: [string]) => cmd === 'systemctl')).toBe(false)
  })

  it('quotes systemd percent specifiers, variables and whitespace in executable paths', () => {
    const ctx = createContext({ ...opts, platform: 'linux', node: '/tmp/space $dollar %unit/node', exists: () => true })
    expect(renderService(ctx)).toContain('ExecStart="/tmp/space $$dollar %%unit/node"')
    expect(renderService(ctx)).toContain('Environment="PATH=/tmp/space $dollar %%unit:')
  })

  it('installs an OpenRC supervisor with a boot runlevel and ordinary user identity', () => {
    opts.platform = 'linux'
    opts.exists = (file: string) => file === '/sbin/openrc-run' || existsSync(file)
    expect(ensureService(opts)).toMatchObject({ managed: true, manager: 'openrc' })
    const ctx = createContext(opts)
    expect(run.mock.calls.some(([cmd, args]) => cmd === 'sudo' && args.includes('install') && args.includes(ctx.serviceFile))).toBe(true)
    expect(run.mock.calls.some(([cmd, args]) => cmd === 'sudo' && args.includes('rc-update') && args.includes('default'))).toBe(true)
    const content = renderService(ctx)
    expect(content).toContain('supervisor=supervise-daemon')
    expect(content).toContain("command_user='501'")
    expect(content).toContain('respawn_max=0')
    expect(content).not.toContain('export PATH=')
    expect(content).toContain('supervise_daemon_args=')
    expect(content).toContain(`pidfile='/run/${ctx.name}.pid'`)
  })

  it('preserves literal OpenRC command arguments across both shell parses', () => {
    const dangerous = `${root}/a ' quote $HOME $(touch SHOULD_NOT_EXIST) ; & end`
    const ctx = createContext({ ...opts, platform: 'linux', node: dangerous, exists: (file: string) => file === '/sbin/openrc-run' })
    const script = join(root, 'openrc-test.sh')
    writeFileSync(script, renderService(ctx) + `\neval "set -- $command $command_args_foreground"\nprintf '%s\\n' "$@"\n`)
    const result = spawnSync('/bin/sh', [script], { encoding: 'utf8', cwd: root })
    expect(result.status).toBe(0)
    expect(result.stdout.trim().split('\n')).toEqual(ctx.command)
    expect(existsSync(join(root, 'SHOULD_NOT_EXIST'))).toBe(false)
  })

  it('does not require repeated OpenRC runlevel authorization after registration', () => {
    opts.platform = 'linux'
    opts.exists = (file: string) => file === '/sbin/openrc-run' || file.startsWith('/etc/runlevels/default/talos-daemon-') || existsSync(file)
    expect(ensureService(opts)).toMatchObject({ managed: true, manager: 'openrc' })
    expect(run.mock.calls.some(([cmd, args]) => cmd === 'sudo' && args.includes('rc-update'))).toBe(false)
  })

  it('persists opt-out across auth repair and allows explicit re-enable', () => {
    ensureService(opts)
    uninstallService(opts)
    run.mockClear()
    expect(ensureService(opts)).toEqual({ managed: false, reason: 'disabled' })
    expect(run).not.toHaveBeenCalled()
    expect(serviceStatus(opts)).toMatchObject({ enabled: false, installed: false })
    expect(ensureService({ ...opts, enable: true })).toMatchObject({ managed: true })
  })

  it('stop unloads the service without disabling future login startup', () => {
    ensureService(opts)
    expect(stopService(opts)).toBe(true)
    expect(serviceStatus(opts)).toMatchObject({ enabled: true, installed: true, active: false })
    expect(isServicePaused(opts)).toBe(true)
    ensureService(opts)
    expect(isServicePaused(opts)).toBe(false)
  })

  it('persists app-driven pause before requesting supervisor stop', () => {
    pauseService(opts)
    expect(isServicePaused(opts)).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it('does not disable shared lingering when removing a Linux service', () => {
    opts.platform = 'linux'
    opts.exists = (file: string) => file === '/run/systemd/system' || existsSync(file)
    ensureService(opts)
    run.mockClear()
    uninstallService(opts)
    expect(run.mock.calls.some(([cmd]) => cmd === 'loginctl')).toBe(false)
    expect(run.mock.calls.some(([cmd, args]) => cmd === 'systemctl' && args.includes('disable'))).toBe(true)
  })

  it('defers root installs and reports unsupported platforms', () => {
    expect(ensureService({ ...opts, uid: 0 })).toMatchObject({ managed: false, reason: 'deferred' })
    expect(ensureService({ ...opts, platform: 'linux', exists: () => false })).toMatchObject({ managed: false, reason: 'unsupported' })
    expect(run).not.toHaveBeenCalled()
  })

  it('only auto-installs from published global npm installs outside CI', () => {
    const prefix = join(root, 'prefix')
    const pkg = join(prefix, 'lib/node_modules/talosapp')
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    writeFileSync(join(pkg, 'dist/index.mjs'), '')
    const env = { npm_config_global: 'true', npm_config_prefix: prefix }
    expect(shouldInstallFromNpm(env, pkg)).toBe(true)
    expect(shouldInstallFromNpm({}, pkg)).toBe(false)
    expect(shouldInstallFromNpm({ ...env, CI: '1' }, pkg)).toBe(false)
    expect(shouldInstallFromNpm({ ...env, npm_command: 'link' }, pkg)).toBe(false)
    mkdirSync(join(pkg, 'src'))
    expect(shouldInstallFromNpm(env, pkg)).toBe(false)
  })

  it('does not provision Talos when it is a dependency of another global npm package', () => {
    const prefix = join(root, 'prefix')
    const dependency = join(prefix, 'lib/node_modules/another-cli/node_modules/talosapp')
    mkdirSync(join(dependency, 'dist'), { recursive: true })
    writeFileSync(join(dependency, 'dist/index.mjs'), '')
    expect(shouldInstallFromNpm({ npm_config_global: 'true', npm_config_prefix: prefix }, dependency)).toBe(false)
  })

  it('recognizes direct pnpm global links and skips unlinked transitive dependencies', () => {
    const modules = join(root, 'pnpm/global/5/node_modules')
    const pkg = join(modules, '.pnpm/talosapp@1.0.4/node_modules/talosapp')
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    writeFileSync(join(pkg, 'dist/index.mjs'), '')
    const env = { npm_config_global: 'true', npm_config_prefix: join(root, 'pnpm/bin') }
    expect(shouldInstallFromNpm(env, pkg)).toBe(false)
    symlinkSync(pkg, join(modules, 'talosapp'), 'dir')
    expect(shouldInstallFromNpm(env, pkg)).toBe(true)
  })

  it('defers unknown global installation layouts to normal account connection', () => {
    expect(shouldInstallFromNpm({ npm_config_global: 'true' }, join(root, 'package'))).toBe(false)
  })
})
