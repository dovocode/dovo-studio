// Native Linux regression check: real input bindings, runtime searches and private draft files.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, access, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
const exec = promisify(execFile)
if (process.platform !== 'linux') throw new Error('This native GUI check requires Linux/X11.')
const directory = await mkdtemp(join(tmpdir(), 'dovo-gpui-browser-check-'))
const children = []
const diagnostics = []
let guiEnvironment
function start(command, args, env) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  child.stdout.on('data', (data) => diagnostics.push(data.toString()))
  child.stderr.on('data', (data) => diagnostics.push(data.toString()))
  child.on('error', (error) => diagnostics.push(error.message))
  return child
}
async function until(read, label) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const result = await read()
    if (result) return result
    await delay(50)
  }
  throw new Error(`Timed out: ${label}`)
}
async function json(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
try {
  const environment = {
    ...process.env,
    DOVO_DATA_ROOT: directory,
    DOVO_DATABASE_PATH: join(directory, 'runtime.sqlite'),
    DOVO_SETTINGS_PATH: join(directory, 'settings.json'),
    DOVO_HOST: '127.0.0.1',
    PORT: '0',
    DOVO_LOGIN_PATH: 'off',
  }
  start(process.execPath, ['scripts/fixtures/gpui-browser.mjs'], environment)
  const connection = await until(
    () => json(join(directory, 'runtime-connection.json')),
    'runtime connection',
  )
  const fixture = await until(() => json(join(directory, 'fixture.json')), 'browser fixture')
  let display = 350
  for (; display < 450; display++) {
    try {
      await access(`/tmp/.X${display}-lock`)
    } catch {
      break
    }
  }
  assert(display < 450, 'No private X display is available')
  start('Xvfb', [`:${display}`, '-screen', '0', '1400x1000x24', '-nolisten', 'tcp'], process.env)
  const gui = {
    ...process.env,
    DISPLAY: `:${display}`,
    XDG_DATA_HOME: join(directory, 'client'),
    WEBKIT_DISABLE_COMPOSITING_MODE: '1',
  }
  guiEnvironment = gui
  await until(async () => {
    try {
      await exec('xdotool', ['getdisplaygeometry'], { env: gui })
      return true
    } catch {
      return false
    }
  }, 'X display')
  const binary = process.env.GPUI_EXECUTABLE || 'apps/desktop-gpui/target/debug/dovo-desktop-gpui'
  start(binary, ['--connection-file', join(directory, 'runtime-connection.json')], gui)
  await until(async () => {
    try {
      const { stdout } = await exec('xdotool', ['search', '--name', '^Dovo Studio GPUI$'], {
        env: gui,
      })
      return stdout.trim()
    } catch {
      return false
    }
  }, 'native window')
  const { stdout: registeredWindow } = await exec(
    'xdotool',
    ['search', '--name', '^Dovo Studio GPUI$'],
    { env: gui },
  )
  await until(async () => {
    try {
      const { stdout: registeredClasses } = await exec(
        'xdotool',
        ['search', '--class', '^dev.dovo.studio.gpui$'],
        { env: gui },
      )
      return registeredClasses.trim().split('\n').includes(registeredWindow.trim().split('\n')[0])
    } catch {
      return false
    }
  }, 'native window class matches its desktop launcher')
  await delay(1200)
  const x = (...args) => exec('xdotool', args, { env: gui })
  const click = (xpos, ypos) => x('mousemove', String(xpos), String(ypos), 'click', '1')
  const key = (...keys) => x('key', '--clearmodifiers', ...keys)
  const type = (value) => x('type', '--clearmodifiers', '--delay', '20', value)
  async function events() {
    return (
      (await json(join(directory, 'browser-events.json'))) || { browserCalls: [], requests: [] }
    )
  }
  async function profiles() {
    const response = await fetch(connection.address + '/api/previews/browser/profiles/read', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert(response.ok)
    return (await response.json()).profiles
  }
  function alive() {
    assert(children.at(-1).exitCode === null, 'Native workbench exited while closing a browser')
  }
  await click(280, 273)
  await click(1270, 495)
  await delay(300)
  await click(1000, 285)
  await key('ctrl+a')
  await type(fixture.url + '/?set=work')
  await click(980, 322)
  for (let index = 0; index < 3; index++) {
    await click(1030, 360)
    await until(
      async () =>
        (await events()).browserCalls.filter((c) => c.method === 'open').length === index + 1,
      'open browser session',
    )
    await until(
      async () => (await events()).requests.length >= index * 2 + 1,
      'Chromium HTTP request',
    )
    await delay(1200)
    await click(242, 120)
    await until(
      async () => (await events()).requests.some((r) => r.cookie === 'work'),
      'profile cookie persisted',
    )
    await click(228, 288)
    if (index === 1) {
      await x('windowraise', registeredWindow.trim().split('\n')[0])
      await click(1055, 436)
    } else {
      await click(1231, 120)
      await click(1078, 254)
    }
    await until(
      async () =>
        (await events()).browserCalls.filter((c) => c.method === 'close').length === index + 1,
      'close exact browser session',
    )
    await delay(700)
    alive()
  }
  const calls = (await events()).browserCalls
  for (const call of calls.filter((c) => c.method === 'open')) {
    const identity = JSON.parse(call.args[0])
    assert.equal(identity[0], fixture.taskId)
    assert.equal(identity[2], 'work')
    assert(
      calls.some((c) => c.method === 'close' && c.args[0] === call.args[0]),
      'Native close changed profile or tab',
    )
  }
  // Xvfb has no window manager to restore focus after closing a child window.
  await x('windowfocus', '--sync', registeredWindow.trim().split('\n')[0])
  await click(135, 832)
  await delay(350)
  await click(650, 552)
  await type('Native Personal')
  await click(1225, 552)
  const added = await until(
    async () => (await profiles()).find((p) => p.name === 'Native Personal'),
    'native profile creation',
  )
  await delay(350)
  await click(650, 552)
  await key('ctrl+a')
  await type('Renamed Personal')
  await click(1153, 552)
  await until(
    async () => (await profiles()).some((p) => p.id === added.id && p.name === 'Renamed Personal'),
    'native profile rename',
  )
  await delay(350)
  await click(1234, 552)
  await delay(250)
  // Confirmation is below the three profile rows.
  await click(451, 620)
  await until(
    async () => !(await profiles()).some((p) => p.id === added.id),
    'native profile removal',
  )
  alive()
  await click(135, 795)
  await delay(700)
  await click(400, 510)
  await delay(300)
  await click(650, 750)
  await type('Fleet task draft')
  await until(async () => {
    for (const path of await readdir(gui.XDG_DATA_HOME, { recursive: true })) {
      if (
        /drafts-.*\.json$/.test(path) &&
        (await json(join(gui.XDG_DATA_HOME, path)))?.[fixture.taskId] === 'Fleet task draft'
      )
        return true
    }
    return false
  }, 'fleet task navigation reaches the native composer')
  console.log(
    'Native browser profiles, cookie persistence, exact session closure, workbench survival and fleet task navigation pass.',
  )
} catch (error) {
  if (process.env.GPUI_SCREENSHOT_DIR && guiEnvironment) {
    await mkdir(process.env.GPUI_SCREENSHOT_DIR, { recursive: true })
    await exec(
      'import',
      ['-window', 'root', join(process.env.GPUI_SCREENSHOT_DIR, 'browser-failure.png')],
      { env: guiEnvironment },
    )
  }
  console.error(diagnostics.join('').slice(-4000))
  throw error
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const closed = new Promise((resolve) => child.once('close', resolve))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    await closed
    clearTimeout(timer)
  }
  await rm(directory, { recursive: true, force: true })
}
