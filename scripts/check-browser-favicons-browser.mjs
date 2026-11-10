import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { RemoteBrowsers } from '../packages/runtime/dist/previews/browser.js'

const requireRuntime = createRequire(new URL('../packages/runtime/package.json', import.meta.url))
const sharp = requireRuntime('sharp')

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

  // Discover Apple icons, tokenized relations and large icons even after many small candidates.
  const candidates = [
    ...Array.from({ length: 9 }, () => ({ rel: 'icon', sizes: '16x16', color: 'red' })),
    { rel: 'APPLE-TOUCH-ICON-PRECOMPOSED', sizes: '180x180', color: 'purple' },
    { rel: 'shortcut ICON', sizes: '256x256', color: 'orange' },
    { rel: 'apple-touch-icon', sizes: '512x512', color: 'blue', media: '(max-width: 1px)' },
  ]
  await evaluate(
    'work',
    `for (const candidate of ${JSON.stringify(candidates)}) {
    const link = document.createElement('link');
    Object.assign(link, candidate, { href: 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="' + candidate.color + '"/></svg>'
    ) }); document.head.append(link);
  }`,
  )
  const largeIcon = (await waitFor('work', (state) => typeof state?.favicon === 'string')).favicon
  const decoded = sharp(Buffer.from(largeIcon.split(',')[1], 'base64'))
  assert.deepEqual(
    await decoded.metadata().then(({ width, height }) => [width, height]),
    [128, 128],
  )
  assert.deepEqual([...(await decoded.raw().toBuffer()).subarray(0, 4)], [255, 165, 0, 255])
  await evaluate(
    'work',
    `document.querySelectorAll('link').forEach(link => {
    if (!link.rel.toLowerCase().includes('apple')) link.remove();
  })`,
  )
  const appleIcon = (
    await waitFor(
      'work',
      (state) => typeof state?.favicon === 'string' && state.favicon !== largeIcon,
    )
  ).favicon
  assert.deepEqual(
    [
      ...(
        await sharp(Buffer.from(appleIcon.split(',')[1], 'base64'))
          .raw()
          .toBuffer()
      ).subarray(0, 4),
    ],
    [128, 0, 128, 255],
  )
  console.log(
    'Remote favicons passed: profile cookies, fallback, SVG, blob icons, dynamic updates, reload, high resolution and Apple touch icons.',
  )
} finally {
  for (const detach of listeners) detach()
  await remote.dispose()
  await new Promise((resolve) => server.close(resolve))
}
