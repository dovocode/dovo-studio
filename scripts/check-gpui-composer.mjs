// Native Linux regression check: real input bindings, runtime searches and private draft files.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
const exec = promisify(execFile)
if (process.platform !== 'linux') throw new Error('This native GUI check requires Linux/X11.')
const directory = await mkdtemp(join(tmpdir(), 'dovo-gpui-composer-check-'))
const children = []
const diagnostics = []
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
  start(process.execPath, ['scripts/fixtures/gpui-composer.mjs'], environment)
  const connection = await until(
    () => json(join(directory, 'runtime-connection.json')),
    'runtime connection',
  )
  const fixture = await json(join(directory, 'fixture.json'))
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
      const { stdout } = await exec('xdotool', ['search', '--name', 'Dovo'], { env: gui })
      return stdout.trim()
    } catch {
      return false
    }
  }, 'native window')
  await delay(1200)
  const x = (...args) => exec('xdotool', args, { env: gui })
  const click = (xpos, ypos) => x('mousemove', String(xpos), String(ypos), 'click', '1')
  const key = (...keys) => x('key', '--clearmodifiers', ...keys)
  const type = (value) => x('type', '--clearmodifiers', '--delay', '20', value)
  const files = async () => {
    try {
      return await readdir(gui.XDG_DATA_HOME, { recursive: true })
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
  async function draft(expected) {
    await until(
      async () => {
        for (const path of await files()) {
          if (
            !path
              .split('/')
              .at(-1)
              .match(/^drafts-.*\.json$/)
          )
            continue
          const saved = await json(join(gui.XDG_DATA_HOME, path))
          if (saved?.[fixture.taskId] === expected) return true
        }
        return false
      },
      `native draft equals ${JSON.stringify(expected)}`,
    )
  }
  await click(430, 270)
  await delay(350)
  await click(735, 735)
  await type('Inspect @hel')
  await delay(600)
  await key('Tab')
  await draft('Inspect @hello.txt ')
  await type('and #pri')
  await key('Return')
  await draft('Inspect @hello.txt and Inspect the 🦀 without edits.')
  await key('ctrl+a')
  await type('$private')
  await key('Return')
  await draft('$private-skill ')
  await key('ctrl+a')
  await type('@private-s')
  await delay(600)
  await key('Return')
  await draft('@private-server ')
  await key('ctrl+a')
  await type('Before @hel suffix')
  await key('Home', ...Array(11).fill('Right'))
  await delay(600)
  await key('Tab')
  await draft('Before @hello.txt  suffix')
  await key('ctrl+a')
  await type('/rev')
  await key('Return')
  await until(async () => {
    const response = await fetch(connection.address + '/api/snapshot', {
      headers: { Authorization: 'Bearer ' + connection.token },
    })
    assert(response.ok)
    const snapshot = await response.json()
    const task = snapshot.workspace.tasks.find((task) => task.id === fixture.taskId)
    return task.messages.some(
      (message) =>
        message.role === 'user' &&
        message.review === true &&
        message.text === 'Review the changes so far.',
    )
  }, 'review command reaches runtime with review mode')
  console.log(
    'Native composer verified: file/skill/MCP/prompt completion, Unicode, surrounding text and review command.',
  )
} catch (error) {
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
