import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Exercise the built CLI across real process exits. The child receives no host agent settings.
const directory = await mkdtemp(join(tmpdir(), 'dovo-terminal-restart-'))
const token = randomUUID()
const cli = new URL('../apps/api/dist/index.js', import.meta.url)
const environment = {
  HOME: directory,
  PATH: process.env.PATH,
  SHELL: '/bin/sh',
  PORT: '0',
  DOVO_DATABASE_PATH: join(directory, 'runtime.sqlite'),
  DOVO_OWNER_TOKEN: token,
  DOVO_LOGIN_PATH: 'off',
  XDG_CONFIG_HOME: join(directory, 'config'),
  XDG_STATE_HOME: join(directory, 'state'),
  XDG_DATA_HOME: join(directory, 'data'),
  CODEX_HOME: join(directory, 'codex'),
  CLAUDE_CONFIG_DIR: join(directory, 'claude'),
  PI_CODING_AGENT_DIR: join(directory, 'pi'),
}

let runtime
let address
let terminalId
let splitId
async function start() {
  runtime = fork(cli, [], {
    cwd: directory,
    env: environment,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  const [ready] = await Promise.race([
    once(runtime, 'message', { signal: AbortSignal.timeout(20000) }),
    once(runtime, 'exit').then(([code]) => {
      throw new Error('Runtime exited during startup: ' + code)
    }),
  ])
  assert.equal(ready.type, 'ready')
  address = ready.address
}

async function stop(signal) {
  if (!runtime || runtime.exitCode !== null || runtime.signalCode !== null) return
  const exited = once(runtime, 'exit', { signal: AbortSignal.timeout(15000) })
  runtime.kill(signal)
  const [code, receivedSignal] = await exited
  if (signal === 'SIGTERM') assert.equal(code, 0, 'Graceful runtime shutdown failed')
  else assert.equal(receivedSignal, signal)
}

function request(path, input) {
  return fetch(address + '/api/terminals/' + path, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(10000),
  })
}

async function post(path, input) {
  const response = await request(path, input)
  assert.equal(response.status, 200, path + ' returned ' + response.status)
  return response.json()
}

async function readScreen(cols, rows, marker) {
  const deadline = Date.now() + 8000
  let last
  while (Date.now() < deadline) {
    const response = await request('screen', { id: terminalId })
    last = await response.json()
    if (response.status === 200 && last.text.includes(marker)) {
      assert.equal(last.cols, cols)
      assert.equal(last.rows, rows)
      assert.equal(last.buffer, 'alternate')
      assert.match(last.text, /header evicted from raw history/)
      return last
    }
    assert.ok(
      response.status === 200 || response.status === 409,
      `screen returned ${response.status}`,
    )
    await delay(40)
  }
  throw new Error('Timed out waiting for the alternate screen: ' + JSON.stringify(last))
}

async function connectTerminal() {
  const { ticket } = await post('ticket', { id: terminalId })
  const socket = new WebSocket(
    address.replace(/^http/, 'ws') + '/ws/terminal?ticket=' + encodeURIComponent(ticket),
  )
  await once(socket, 'open', { signal: AbortSignal.timeout(8000) })
  return socket
}

async function readMarker(name) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try {
      const marker = await readFile(join(directory, name), 'utf8')
      if (marker.endsWith('\n')) return marker
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await delay(40)
  }
  throw new Error('Timed out waiting for ' + name)
}

try {
  await writeFile(
    join(directory, 'foreground.cjs'),
    `
    const fs = require('node:fs')
    function start() {
      if (!fs.existsSync('report-start')) return setTimeout(start, 20)
      fs.appendFileSync('starts', process.pid + '\\n')
      process.stdin.setRawMode(true)
      process.stdout.write('\\x1b]7501;state=working:turnId=initial\\x07\\x1b]7501;state=done:turnId=initial\\x07')
      process.stdout.write('\\x1b]7501;id=review:state=blocked:kind=permission\\x07')
      process.stdout.write('\\x1b[?1049h\\x1b[2J\\x1b[Hheader evicted from raw history')
      process.stdout.write('\\x1b[0m'.repeat(270000), () => {
        process.stdout.write('\\x1b[6;3Hterminal-screen-ready')
      })
      process.on('SIGWINCH', () => {
        process.stdout.write('\\x1b[12;1Hgrid-ready:' + process.stdout.getWindowSize().join('x'))
      })
      process.stdin.on('data', data => {
        if (data.toString().trim() === 'review') {
          // A reporter can repeat a completed turn after the runtime reconnects.
          const report = id => '\\x1b]7501;state=working:turnId=' + id + '\\x07\\x1b]7501;state=done:turnId=' + id + '\\x07'
          process.stdout.write(report('initial') + report('review'))
          return
        }
        fs.writeFileSync('finish', process.pid + ' ' + data.toString().trim() + '\\n')
        setInterval(() => {}, 60000)
      })
    }
    start()
  `,
  )
  await writeFile(
    join(directory, 'split.cjs'),
    `
    const fs = require('node:fs')
    const report = setInterval(() => {
      if (!fs.existsSync('report-start')) return
      clearInterval(report)
      fs.appendFileSync('split-starts', process.pid + '\\n')
    }, 20)
  `,
  )
  await start()
  const input = { rememberSession: true, requestId: randomUUID(), command: 'node foreground.cjs' }
  const session = await post('workspace', input)
  terminalId = session.id
  await stop('SIGKILL')
  await assert.rejects(readFile(join(directory, 'starts')), { code: 'ENOENT' })
  await start()
  assert.equal((await post('workspace', input)).id, terminalId)
  const splitInput = {
    sourceTerminalId: terminalId,
    requestId: randomUUID(),
    command: 'node split.cjs',
  }
  splitId = (await post('workspace', splitInput)).id
  await stop('SIGKILL')
  await assert.rejects(readFile(join(directory, 'split-starts')), { code: 'ENOENT' })
  await start()
  assert.equal((await post('workspace', input)).id, terminalId)
  assert.equal((await post('workspace', splitInput)).id, splitId)
  await writeFile(join(directory, 'report-start'), '')
  assert.match(await readMarker('split-starts'), /^\d+\n$/)
  await post('close', { id: splitId })
  splitId = undefined
  const pid = (await readMarker('starts')).trim()
  assert.match(pid, /^\d+$/)
  await readScreen(100, 24, 'terminal-screen-ready')
  const initialViewer = await connectTerminal()
  initialViewer.send(JSON.stringify({ type: 'resize', cols: 82, rows: 18 }))
  let before
  try {
    before = await readScreen(82, 18, 'grid-ready:82x18')
  } finally {
    initialViewer.close()
  }
  const view = { turn: 1, expectedRevision: 0, seen: true }
  assert.equal((await post('update', { id: terminalId, view })).seenTurn, 1)
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    await stop(signal)
    await start()
    assert.equal((await post('workspace', input)).id, terminalId)
    const restored = await readScreen(82, 18, 'grid-ready:82x18')
    assert.deepEqual(restored, before)
    const response = await fetch(address + '/api/snapshot?scope=overview', {
      headers: { authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(10000),
    })
    assert.equal(response.status, 200)
    const terminal = (await response.json()).terminals.find((item) => item.id === terminalId)
    assert.equal(terminal.turn, 1)
    assert.equal(terminal.activity?.turnId, 'initial')
    assert.equal(terminal.seenTurn, 1)
    assert.equal(terminal.seenRevision, 1)
    assert.deepEqual(terminal.childActivities, [
      { id: 'review', activity: { state: 'blocked', kind: 'permission' } },
    ])
    assert.equal((await request('update', { id: terminalId, view })).status, 409)
  }

  const receipt = await post('send', { id: terminalId, data: 'review\r' })
  assert.equal(receipt.turn, 1)
  const completed = await post('summary', {
    id: terminalId,
    afterTurn: receipt.turn,
    until: ['done'],
    waitMs: 5000,
  })
  assert.equal(completed.waitResult, 'activity')
  assert.equal(completed.turn, 2)
  assert.equal(completed.activity?.turnId, 'review')

  const socket = await connectTerminal()
  try {
    socket.send(JSON.stringify({ type: 'input', data: 'continue\r' }))
    assert.equal(await readMarker('finish'), pid + ' continue\n')
    assert.equal(await readMarker('starts'), pid + '\n')
  } finally {
    socket.close()
  }
  await post('close', { id: terminalId })
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      process.kill(Number(pid), 0)
    } catch (error) {
      if (error.code === 'ESRCH') break
      throw error
    }
    assert.ok(Date.now() < deadline, 'Explicit close left the foreground process running')
    await delay(40)
  }
  terminalId = undefined
  console.log(
    'Initial and split commands ran once after immediate runtime crashes. The foreground process, alternate screen, grid, read turn and blocked child survived graceful and abrupt runtime exits.',
  )
} finally {
  try {
    if (runtime?.exitCode === null && runtime.signalCode === null)
      for (const id of [terminalId, splitId]) if (id) await post('close', { id })
  } finally {
    await stop('SIGTERM')
    await rm(directory, { recursive: true, force: true })
  }
}
