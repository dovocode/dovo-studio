import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  console.log(
    'Real Chromium: independent tabs, paused streams, scoped cleanup, shared logins within a profile, profile isolation, and saved cookies/local storage across runtime restart passed.',
  )
} finally {
  for (const detach of dispose) detach()
  await browsers.dispose()
  server.close()
  await rm(profileDirectory, { recursive: true, force: true })
}
