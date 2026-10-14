import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, access, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
const exec = promisify(execFile)
if (process.platform !== 'linux') throw new Error('This native GUI check requires Linux/X11.')
const directory = await mkdtemp(join(tmpdir(), 'dovo-gpui-servers-check-'))
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
  start(process.execPath, ['scripts/fixtures/gpui-servers.mjs'], {
    ...process.env,
    DOVO_DATA_ROOT: directory,
    DOVO_HOST: '127.0.0.1',
    PORT: '0',
    DOVO_LOGIN_PATH: 'off',
  })
  for (const name of ['first', 'second'])
    await until(() => json(join(directory, name, 'runtime-connection.json')), `${name} runtime`)
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
  const x = (...args) => exec('xdotool', args, { env: gui })
  const click = (xpos, ypos) => x('mousemove', String(xpos), String(ypos), 'click', '1')
  const key = (...keys) => x('key', '--clearmodifiers', ...keys)
  const type = (value) => x('type', '--clearmodifiers', '--delay', '20', value)
  await until(async () => {
    try {
      await x('getdisplaygeometry')
      return true
    } catch {
      return false
    }
  }, 'X display')
  start(
    process.env.GPUI_EXECUTABLE || 'apps/desktop-gpui/target/debug/dovo-desktop-gpui',
    [
      '--connection-file',
      join(directory, 'first/runtime-connection.json'),
      '--connection-file',
      join(directory, 'second/runtime-connection.json'),
    ],
    gui,
  )
  await until(async () => {
    try {
      return (await x('search', '--name', '^Dovo Studio GPUI$')).stdout.trim()
    } catch {
      return false
    }
  }, 'native workbench')
  await delay(1200)
  async function draftValues() {
    const values = []
    for (const path of await readdir(gui.XDG_DATA_HOME, { recursive: true }))
      if (/drafts-.*\.json$/.test(path))
        values.push((await json(join(gui.XDG_DATA_HOME, path)))?.['shared-task'])
    return values
  }
  await click(280, 273)
  await click(650, 750)
  await type('First server private draft')
  await until(
    async () => (await draftValues()).includes('First server private draft'),
    'first scoped draft',
  )
  // The other server's thread is in the same sidebar, with its own origin.
  await click(280, 390)
  await delay(1000)
  await click(280, 273)
  await click(650, 750)
  await type('Second server private draft')
  await until(async () => {
    const values = await draftValues()
    return (
      values.includes('First server private draft') &&
      values.includes('Second server private draft')
    )
  }, 'colliding task IDs have independent draft files')
  // Switch back; the remembered task should open without another task-row click.
  await click(240, 137)
  await delay(200)
  await click(310, 179)
  await delay(1000)
  await click(650, 750)
  await key('End')
  await type(' restored')
  await until(async () => {
    const values = await draftValues()
    return (
      values.includes('First server private draft restored') &&
      values.includes('Second server private draft')
    )
  }, 'switching back restores the first task and composer')
  await click(135, 795)
  await delay(1000)
  // The second server's task is in the compact second overview card.
  const nativeWindow = (await x('search', '--name', '^Dovo Studio GPUI$')).stdout.trim()
  const geometry = Object.fromEntries(
    (await x('getwindowgeometry', '--shell', nativeWindow)).stdout
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  )
  await click(Number(geometry.X) + 288, Number(geometry.Y) + 565)
  await delay(1000)
  await click(650, 750)
  await key('End')
  await type(' from overview')
  await until(async () => {
    const values = await draftValues()
    return (
      values.includes('First server private draft restored') &&
      values.includes('Second server private draft from overview')
    )
  }, 'overview task navigation retains its server origin')
  console.log(
    'Native cross-server thread sidebar, server picker, scoped drafts and overview navigation pass.',
  )
} catch (error) {
  if (process.env.GPUI_SCREENSHOT_DIR && guiEnvironment) {
    await mkdir(process.env.GPUI_SCREENSHOT_DIR, { recursive: true })
    await exec(
      'import',
      ['-window', 'root', join(process.env.GPUI_SCREENSHOT_DIR, 'servers-failure.png')],
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
