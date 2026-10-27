import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { RemoteBrowsers } from '../packages/runtime/dist/previews/browser.js'

const svg = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`
const server = createServer((request, response) => {
  if (request.url === '/bad' || request.url === '/favicon.ico') {
    response.writeHead(404)
    response.end()
    return
  }
  if (request.url === '/icon') {
    response.setHeader('Content-Type', 'application/octet-stream')
    response.end(svg(request.headers.cookie?.includes('icon=work') ? 'red' : 'blue'))
    return
  }
  const profile = request.url === '/work' ? 'work' : 'personal'
  response.setHeader('Set-Cookie', `icon=${profile}; Path=/; HttpOnly`)
  response.setHeader('Content-Type', 'text/html')
  response.end(
    '<title>Icons</title><link rel="icon" href="/bad"><link rel="icon" href="/icon"><body>Page</body>',
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const remote = new RemoteBrowsers()
const listeners = []
const states = new Map()
const waiters = new Set()
const waitFor = (id, predicate) => {
  if (predicate(states.get(id))) return Promise.resolve(states.get(id))
  return new Promise((resolve, reject) => {
    const waiting = () => {
      const value = states.get(id)
      if (predicate(value)) {
        clearTimeout(timer)
        waiters.delete(waiting)
        resolve(value)
      }
    }
    const timer = setTimeout(() => {
      waiters.delete(waiting)
      reject(new Error(`Favicon state timed out for ${id}: ${JSON.stringify(states.get(id))}`))
    }, 10000)
    waiters.add(waiting)
  })
}
const evaluate = (id, script) =>
  remote.agentCommand('icons', { action: 'evaluate', script }, () => {}, id)
try {
  for (const profile of ['work', 'personal']) {
    await remote.open(profile, 'icons', profile, `${origin}/${profile}`)
    listeners.push(
      await remote.attach(profile, (message) => {
        if (message.type !== 'state') return
        states.set(profile, message)
        for (const ready of [...waiters]) ready()
      }),
    )
  }
  const work = (await waitFor('work', (state) => typeof state?.favicon === 'string')).favicon
  const personal = (await waitFor('personal', (state) => typeof state?.favicon === 'string'))
    .favicon
  assert.match(work, /^data:image\/png;base64,/)
  assert.notEqual(work, personal, 'Remote favicon requests must carry their own profile cookies.')
  const inline = 'data:image/svg+xml,' + encodeURIComponent(svg('green'))
  await evaluate(
    'work',
    `document.querySelectorAll('link[rel="icon"]')[1].href=${JSON.stringify(inline)}`,
  )
  const dynamic = (
    await waitFor('work', (state) => typeof state?.favicon === 'string' && state.favicon !== work)
  ).favicon
  await evaluate(
    'work',
    `document.querySelectorAll('link[rel="icon"]')[1].href=URL.createObjectURL(new Blob([${JSON.stringify(svg('yellow'))}],{type:'image/svg+xml'}))`,
  )
  await waitFor('work', (state) => typeof state?.favicon === 'string' && state.favicon !== dynamic)
  await remote.input('work', { type: 'reload' })
  await waitFor('work', (state) => state?.favicon === work)
  await evaluate(
    'work',
    `document.querySelectorAll('link[rel="icon"]').forEach(link=>link.remove())`,
  )
  await waitFor('work', (state) => state?.favicon === null)
  console.log(
    'Remote favicons passed: profile cookies, broken candidates, inline SVG, blob icons, dynamic updates, reload and missing-icon fallback.',
  )
} finally {
  for (const detach of listeners) detach()
  await remote.dispose()
  await new Promise((resolve) => server.close(resolve))
}
