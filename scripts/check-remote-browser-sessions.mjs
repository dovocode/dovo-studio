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
const wait = async (condition) => {
  for (let i = 0; i < 100; i++) {
    if (condition()) return
    await delay(50)
  }
  throw new Error('Browser state did not arrive')
}
try {
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
    'Real Chromium: unavailable-server recovery, crash cleanup, dialog reconnect, independent tabs, paused streams, scoped cleanup, profile isolation and restart persistence passed.',
  )
} finally {
  for (const detach of dispose) detach()
  await browsers.dispose()
  server.close()
  await rm(profileDirectory, { recursive: true, force: true })
}
