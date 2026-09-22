// Reproducible host-side input latency. Uses an isolated context and local fixture;
// these results exclude phone/network latency and must not be presented as device FPS.
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { mkdir, writeFile } from 'node:fs/promises'
import { RemoteBrowsers } from '../packages/runtime/dist/previews/browser.js'
const server = createServer((_, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(
    '<style>body{height:100000px;background:repeating-linear-gradient(#aab,#dde 120px);font:18px system-ui}input{position:fixed;top:20px;left:20px}</style><input autofocus>',
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browsers = new RemoteBrowsers()
const results = []
try {
  await browsers.open('benchmark')
  let frames = 0,
    bytes = 0
  const detach = await browsers.attach('benchmark', (message) => {
    if (message.type === 'frame') {
      frames++
      bytes +=
        typeof message.data === 'string'
          ? Buffer.byteLength(message.data, 'base64')
          : message.data.byteLength
    }
  })
  await browsers.input('benchmark', { type: 'resize', width: 390, height: 700 })
  await browsers.input('benchmark', {
    type: 'navigate',
    url: `http://127.0.0.1:${server.address().port}`,
  })
  for (let run = 0; run < 3; run++) {
    frames = 0
    bytes = 0
    const start = performance.now()
    const scrolls = []
    for (let index = 0; index < 60; index++) {
      scrolls.push(
        browsers.input('benchmark', { type: 'scroll', x: 200, y: 300, deltaX: 0, deltaY: 12 }),
      )
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    const lastSent = performance.now()
    await Promise.all(scrolls)
    const scrollDrained = performance.now()
    const typing = []
    for (let index = 0; index < 30; index++)
      typing.push(browsers.input('benchmark', { type: 'text', text: 'a' }))
    await Promise.all(typing)
    results.push({
      scrollInputMs: Math.round(lastSent - start),
      scrollTailMs: Math.round(scrollDrained - lastSent),
      typingBurstMs: Math.round(performance.now() - scrollDrained),
      frames,
      jpegBytes: bytes,
    })
  }
  detach()
  const report = { scope: 'Host input queue on loopback; not phone/network latency', runs: results }
  console.log(JSON.stringify(report, null, 2))
  await mkdir('work/design/remote-browser/performance', { recursive: true })
  await writeFile(
    `work/design/remote-browser/performance/${process.argv[2] ?? 'current'}.json`,
    JSON.stringify(report, null, 2) + '\n',
  )
} finally {
  await browsers.dispose()
  await new Promise((resolve) => server.close(resolve))
}
