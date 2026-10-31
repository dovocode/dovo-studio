import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { STUDIO_BROWSER_SCOPE } from '../packages/protocol/dist/index.js'
import { RemoteBrowsers } from '../packages/runtime/dist/previews/browser.js'
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  if (request.url === '/login') {
    response.setHeader('Set-Cookie', 'profileLogin=work; Max-Age=3600; Path=/')
    response.end('<script>localStorage.setItem("login","work");document.title="logged in"</script>')
    return
  }
  if (request.url === '/profile-state') {
    response.end(
      '<script>document.title=(document.cookie||"empty")+"|"+(localStorage.getItem("login")||"empty")</script>',
    )
    return
  }
  response.end(
    `<title>${request.url}</title><input value="saved"><style>body{animation:pulse .2s infinite alternate}@keyframes pulse{from{background:red}to{background:blue}}</style>`,
  )
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Missing port')
let firstListener
const profileDirectory = await mkdtemp(join(tmpdir(), 'dovo-browser-profiles-check-'))
let browsers = new RemoteBrowsers(profileDirectory)
const dispose = []
const states = new Map()
const frames = new Map()
const listener = (id) => (message) => {
  if (message.type === 'state') states.set(id, message)
  if (message.type === 'frame') frames.set(id, (frames.get(id) ?? 0) + 1)
  if (message.type === 'error') throw new Error(message.message)
}
const wait = async (condition, message = 'Browser state did not arrive') => {
  for (let i = 0; i < 100; i++) {
    if (condition()) return
    await delay(50)
  }
  throw new Error(message)
}
try {
  await browsers.open(
    'capture-lifecycle',
    'capture-lifecycle',
    'default',
    `http://127.0.0.1:${address.port}/capture-lifecycle`,
  )
  const captureSession = await browsers.sessions.get('capture-lifecycle')
  await browsers.input('capture-lifecycle', { type: 'resize', width: 2048, height: 1440 })
  const screencast = captureSession.page.screencast
  const start = screencast.start
  const stop = screencast.stop
  const captures = []
  const captureErrors = []
  const detailSizes = new Set()
  let stops = 0
  let deliveredFrames = 0
  // Observe the production calls and real Chromium frames; keep both real methods running.
  screencast.start = async (options) => {
    const capture = { fps: options.fps, quality: options.quality, size: options.size, frames: 0 }
    await start.call(screencast, {
      ...options,
      onFrame: (frame) => {
        capture.frames++
        options.onFrame(frame)
      },
    })
    captures.push(capture)
  }
  screencast.stop = async () => {
    await stop.call(screencast)
    stops++
  }
  const captureListener = (message) => {
    if (message.type === 'frame') {
      deliveredFrames++
      if (message.detail) detailSizes.add(`${message.width}x${message.height}`)
    }
    if (message.type === 'error') captureErrors.push(message.message)
  }
  try {
    dispose.push(await browsers.attach('capture-lifecycle', captureListener))
    assert.equal(captures[0]?.fps, 30, 'Attaching starts responsive capture')
    assert.equal(captures[0].quality, 70)
    assert.deepEqual(captures[0].size, { width: 1920, height: 1440 })
    await wait(() => captures[0].frames > 1, 'Attached capture must deliver real live frames')
    await wait(() => captures.at(-1)?.fps === 15, 'Viewing without input must reduce capture FPS')
    const idleCapture = captures.at(-1)
    assert.deepEqual(idleCapture.size, { width: 1280, height: 1280 })
    assert.ok(stops > 0, 'Changing capture FPS stops the previous real stream')
    await wait(() => idleCapture.frames > 1, 'Idle capture must continue delivering live frames')
    await captureSession.page.evaluate(() => (document.body.style.animationPlayState = 'paused'))
    await wait(
      () => detailSizes.has('2048x1440'),
      'Settled motion retains device-resolution detail',
    )
    await captureSession.page.evaluate(() => (document.body.style.animationPlayState = 'running'))
    const idleStarts = captures.length
    await browsers.input('capture-lifecycle', { type: 'status' })
    await captureSession.stream
    assert.equal(captures.length, idleStarts, 'Status queries must not reactivate capture')
    const rejectedInput = new Error('Capture authorization rejected')
    await assert.rejects(
      browsers.input('capture-lifecycle', { type: 'key', key: 'Tab' }, () => {
        throw rejectedInput
      }),
      rejectedInput,
    )
    await captureSession.queue
    await captureSession.stream
    assert.equal(captures.length, idleStarts, 'Rejected input must not reactivate capture')
    assert.deepEqual(captureErrors.splice(0), [rejectedInput.message])
    let authorizations = 0
    await browsers.input('capture-lifecycle', { type: 'key', key: 'Tab' }, () => {
      authorizations++
    })
    assert.equal(authorizations, 1)
    await wait(() => captures.at(-1)?.fps === 30, 'Authorized input restores responsive capture')
    const activeCapture = captures.at(-1)
    assert.deepEqual(activeCapture.size, { width: 1920, height: 1440 })
    await wait(() => activeCapture.frames > 1, 'Reactivated capture must deliver live frames')
    const activeStops = stops
    await browsers.visibility('capture-lifecycle', captureListener, false)
    assert.equal(stops, activeStops + 1, 'Hiding stops the real active screencast')
    const hiddenStarts = captures.length
    const hiddenFrames = deliveredFrames
    // Let the original activity deadline pass before another input can replace its timer.
    await delay(2300)
    assert.equal(
      captures.length,
      hiddenStarts,
      'The activity deadline must not restart hidden capture',
    )
    assert.equal(deliveredFrames, hiddenFrames, 'Hiding must stop frame delivery through idle')
    await browsers.input('capture-lifecycle', { type: 'key', key: 'Escape' })
    await browsers.input('capture-lifecycle', { type: 'resize', width: 900, height: 600 })
    // Cross the real activity deadline: queued input/resize and the idle timer must stay stopped.
    await delay(2300)
    assert.equal(
      captures.length,
      hiddenStarts,
      'Input, resize and idle must not restart hidden capture',
    )
    assert.equal(deliveredFrames, hiddenFrames, 'Hidden viewers receive no live or detail frames')
    assert.deepEqual(captureSession.page.viewportSize(), { width: 900, height: 600 })
    await browsers.visibility('capture-lifecycle', captureListener, true)
    assert.equal(captures.at(-1)?.fps, 30, 'Showing the viewer starts responsive capture again')
    assert.deepEqual(captures.at(-1).size, { width: 900, height: 600 })
    const shownCapture = captures.at(-1)
    await wait(() => shownCapture.frames > 1, 'Showing the viewer resumes real live frames')
    const resizeStarts = captures.length
    await browsers.input('capture-lifecycle', { type: 'resize', width: 800, height: 600 })
    assert.ok(captures.length > resizeStarts, 'Visible resize restarts the real screencast')
    assert.equal(captures.at(-1).fps, 30)
    assert.deepEqual(captures.at(-1).size, { width: 800, height: 600 })
    const resizedCapture = captures.at(-1)
    await wait(() => resizedCapture.frames > 1, 'Resizing must retain live capture')
    await wait(() => captures.at(-1)?.fps === 15, 'Resized capture must become idle again')
    assert.deepEqual(captures.at(-1).size, { width: 800, height: 600 })
    const resizedIdleCapture = captures.at(-1)
    await wait(() => resizedIdleCapture.frames > 1, 'Resized idle capture must remain live')
    await captureSession.page.evaluate(() => (document.body.style.animationPlayState = 'paused'))
    await wait(() => detailSizes.has('800x600'), 'Settled resize must retain sharp detail capture')
    assert.deepEqual(captureErrors, [], 'Capture lifecycle must not emit browser errors')
  } finally {
    await browsers.close('capture-lifecycle')
    screencast.start = start
    screencast.stop = stop
  }
  for (const [id, owner] of [
    ['first', 'task'],
    ['second', 'task'],
    ['other', 'other-task'],
  ]) {
    await browsers.open(id, owner)
    const receive = listener(id)
    dispose.push(await browsers.attach(id, receive))
    if (id === 'first') firstListener = receive
    await browsers.input(id, { type: 'navigate', url: `http://127.0.0.1:${address.port}/${id}` })
  }
  await wait(
    () => states.get('first')?.title === '/first' && states.get('second')?.title === '/second',
  )
  assert.notEqual(states.get('first').url, states.get('second').url)
  await wait(() => (frames.get('first') ?? 0) > 2)
  await browsers.visibility('first', firstListener, false)
  await delay(100)
  const before = frames.get('first')
  await delay(300)
  assert.equal(frames.get('first'), before)
  await browsers.visibility('first', firstListener, true)
  await wait(() => frames.get('first') > before)
  await browsers.close('first')
  await browsers.input('second', { type: 'status' })
  await browsers.closeTask('task')
  await assert.rejects(browsers.input('second', { type: 'status' }), /expired/)
  await browsers.input('other', { type: 'status' })
  await browsers.dispose()
  browsers = new RemoteBrowsers(profileDirectory)
  const origin = `http://127.0.0.1:${address.port}`
  const unavailable = createServer()
  unavailable.listen(0, '127.0.0.1')
  await once(unavailable, 'listening')
  const unavailablePort = unavailable.address().port
  await new Promise((resolve) => unavailable.close(resolve))
  const unavailableUrl = `http://127.0.0.1:${unavailablePort}/recover`
  await browsers.open('unavailable', 'recovery', 'default', unavailableUrl)
  await browsers.open('agent-unavailable', 'recovery', 'default', unavailableUrl)
  const recoveryStates = []
  dispose.push(
    await browsers.attach('unavailable', (message) => {
      if (message.type === 'state') recoveryStates.push(message)
    }),
  )
  await wait(() => recoveryStates.at(-1)?.url === unavailableUrl)
  const recovered = createServer((_request, response) => {
    response.end('<title>Recovered server</title>Back online')
  })
  try {
    recovered.listen(unavailablePort, '127.0.0.1')
    await once(recovered, 'listening')
    await browsers.input('unavailable', { type: 'reload' })
    await wait(() => recoveryStates.at(-1)?.title === 'Recovered server')
    await browsers.agentCommand('recovery', { action: 'reload' }, () => {}, 'agent-unavailable')
    const agentSession = await browsers.sessions.get('agent-unavailable')
    assert.equal(
      await agentSession.page.title(),
      'Recovered server',
      'Agent reload also recovers a failed navigation',
    )
    await browsers.agentCommand(
      'recovery',
      { action: 'navigate', url: origin + '/profile-state' },
      () => {},
      'agent-unavailable',
    )
    assert.equal(
      agentSession.state.url,
      origin + '/profile-state',
      'Successful agent navigation clears the failed address',
    )
    await browsers.close('agent-unavailable')
    const session = await browsers.sessions.get('unavailable')
    const closed = new Promise((resolve) => session.page.once('close', resolve))
    await session.cdp.send('Page.crash').catch(() => {})
    await closed
    assert.equal(browsers.sessions.has('unavailable'), false, 'Crashed sessions are released')
    await browsers.open('unavailable', 'recovery', 'default', unavailableUrl)
    dispose.push(
      await browsers.attach('unavailable', (message) => {
        if (message.type === 'state') recoveryStates.push(message)
      }),
    )
    await browsers.input('unavailable', { type: 'status' })
    await browsers.close('unavailable')
  } finally {
    await browsers.close('unavailable')
    await new Promise((resolve) => recovered.close(resolve))
  }
  await browsers.open('dialog-recovery', 'recovery', 'default', origin)
  const dialogMessages = []
  const firstDialogViewer = await browsers.attach('dialog-recovery', (message) =>
    dialogMessages.push(message),
  )
  dispose.push(firstDialogViewer)
  const dialogSession = await browsers.sessions.get('dialog-recovery')
  const alertFinished = dialogSession.page.evaluate(() => alert('Reconnect question'))
  // Cleanup closes the page if attachment fails; the original promise is asserted below.
  void alertFinished.catch(() => {})
  await wait(() => dialogMessages.some((message) => message.type === 'dialog'))
  const replayed = []
  let dialogTimeout
  try {
    const secondDialogViewer = await Promise.race([
      browsers.attach('dialog-recovery', (message) => replayed.push(message)),
      new Promise((_, reject) => {
        dialogTimeout = setTimeout(
          () => reject(new Error('Attaching during a dialog must not block')),
          3000,
        )
      }),
    ])
    dispose.push(secondDialogViewer)
    assert.equal(
      replayed.some(
        (message) => message.type === 'dialog' && message.message === 'Reconnect question',
      ),
      true,
    )
    secondDialogViewer()
    await browsers.input('dialog-recovery', { type: 'dialog', accept: true })
    await alertFinished
  } finally {
    clearTimeout(dialogTimeout)
    await browsers.close('dialog-recovery')
  }
  await browsers.open('work-login', 'profiles', 'work', origin + '/login')
  await browsers.open('work-check', 'profiles', 'work', origin + '/profile-state')
  dispose.push(await browsers.attach('work-check', listener('work-check')))
  await browsers.open('personal-check', 'profiles', 'personal', origin + '/profile-state')
  dispose.push(await browsers.attach('personal-check', listener('personal-check')))
  await wait(
    () =>
      states.get('work-check')?.title === 'profileLogin=work|work' &&
      states.get('personal-check')?.title === 'empty|empty',
  )
  await browsers.closeTask('profiles')
  await browsers.dispose()
  browsers = new RemoteBrowsers(profileDirectory)
  await browsers.open('restart-check', 'profiles', 'work', origin + '/profile-state')
  dispose.push(await browsers.attach('restart-check', listener('restart-check')))
  await wait(() => states.get('restart-check')?.title === 'profileLogin=work|work')
  await browsers.close('restart-check')
  const privateId = 'private-00000000-0000-4000-8000-000000000002'
  const privateResource = JSON.stringify([STUDIO_BROWSER_SCOPE, 'private-tab', privateId])
  await browsers.open(privateResource, STUDIO_BROWSER_SCOPE, privateId, origin + '/login')
  const privatePage = (await browsers.sessions.get(privateResource)).page
  assert.equal(await privatePage.evaluate(() => navigator.language), 'en-US')
  assert.match(await privatePage.evaluate(() => document.cookie), /profileLogin=work/)
  assert.equal(existsSync(join(profileDirectory, 'browser-workspace.profiles', privateId)), false)
  await browsers.close(privateResource)
  await browsers.open(privateResource, STUDIO_BROWSER_SCOPE, privateId, origin + '/profile-state')
  const parent = (await browsers.sessions.get(privateResource)).page
  assert.equal(
    await parent.title(),
    'empty|empty',
    'Closing the private tab must discard cookies and local storage.',
  )
  dispose.push(await browsers.attach(privateResource, listener('private-parent')))
  await parent.evaluate((origin) => {
    window.child = window.open('', 'new')
    setTimeout(() => (window.child.location.href = origin + '/child'), 40)
  }, origin)
  await wait(() => states.get('private-parent')?.createdTabs?.length === 1)
  const childTab = states.get('private-parent').createdTabs[0]
  const childResource = JSON.stringify([STUDIO_BROWSER_SCOPE, childTab.id, privateId])
  const child = (await browsers.sessions.get(childResource)).page
  await child.waitForURL(origin + '/child')
  assert.equal(await child.evaluate(() => !!window.opener), true)
  await child.evaluate(() => (window.opener.document.title = 'retained opener'))
  assert.equal(await parent.title(), 'retained opener')
  await parent.evaluate((origin) => {
    window.sameChild = window.open(origin + '/child2', 'new') === window.child
  }, origin)
  assert.equal(await parent.evaluate(() => window.sameChild), true)
  await child.waitForURL(origin + '/child2')
  let closedMessage
  dispose.push(
    await browsers.attach(childResource, (message) => {
      if (message.type === 'closed') closedMessage = message
    }),
  )
  await child.evaluate(() => window.close())
  await wait(() => !browsers.sessions.has(childResource))
  assert.equal(closedMessage?.byPage, true)
  assert.equal(parent.isClosed(), false)
  await browsers.close(privateResource)
  console.log(
    'Real Chromium: active/idle capture, authorized input, hidden capture, viewport caps, resize/detail frames, unavailable-server recovery, crash cleanup, dialog reconnect, independent tabs, paused streams, scoped cleanup, profile isolation and restart persistence passed.',
  )
} finally {
  for (const detach of dispose) detach()
  await browsers.dispose()
  server.close()
  await rm(profileDirectory, { recursive: true, force: true })
}
