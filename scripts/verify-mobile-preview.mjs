import { startRuntime } from '../packages/runtime/dist/index.js'
import { previewDevices } from '../packages/runtime/dist/previews/devices.js'
import { readFile, writeFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
const device = process.argv[2]
const remote = process.argv.includes('--remote')
const liveSimulator = process.argv
  .find((arg) => arg.startsWith('--live-simulator='))
  ?.slice('--live-simulator='.length)
const visits = []
const typed = []
const browserInputs = []
if (!device) throw new Error('Pass an isolated simulator UUID with Dovo installed')
const directory = await mkdtemp(join(tmpdir(), 'dovo-preview-flow-'))
const runtime = await startRuntime({
  databasePath: ':memory:',
  ownerToken: randomBytes(32).toString('hex'),
  port: 0,
})
const browserInput = runtime.services.browsers.input.bind(runtime.services.browsers)
runtime.services.browsers.input = async (...args) => {
  browserInputs.push(args[1])
  return browserInput(...args)
}
const server = createServer(async (req, res) => {
  visits.push(req.url)
  if (req.url === '/capture') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    typed.push(Buffer.concat(chunks).toString())
    res.end('ok')
    return
  }
  res.setHeader('Content-Type', 'text/html')
  res.end(
    `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui}input{font:inherit;padding:12px;width:90%}</style><h1>Preview fixture</h1><input autofocus aria-label="Host field" oninput="fetch('/capture',{method:'POST',body:this.value})"><p><a href="/next">Next page</a></p>`,
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const code = runtime.services.pairing.createCode().code
runtime.services.store.update((w) => ({
  ...w,
  repositories: [{ id: 'preview-repo', name: 'Preview project', path: directory, branch: 'main' }],
  tasks: [
    {
      id: 'mobile-task',
      title: 'Browser preview',
      repositoryId: 'preview-repo',
      agentId: '',
      status: 'draft',
      createdAt: new Date().toISOString(),
      messages: [
        { id: 'font-user', role: 'user', text: 'Make the mobile chat more compact.' },
        {
          id: 'font-assistant',
          role: 'assistant',
          text: '### Smaller chat text\n\nMessages now use **15-point text** with tighter spacing.\n\n- Both sides use the same size.\n- Inline `code` stays readable.\n- Accessibility text scaling is preserved.',
        },
      ],
      files: [],
      draft: '',
      example: false,
    },
  ],
}))
const approve = setInterval(() => {
  for (const request of runtime.services.pairing.pending())
    if (request.name === 'Dovo simulator test') runtime.services.pairing.approve(request.id, true)
}, 250)
try {
  const tabs = (flow) =>
    flow.replace(
      /^(\s*)id: Tab (.+)$/gm,
      (_match, indent, label) =>
        `${indent}text: ${label}\n${indent}childOf:\n${indent}  text: Tab Bar`,
    )
  for (const file of await readdir('apps/mobile/maestro'))
    if (file.endsWith('.yaml'))
      await writeFile(
        join(directory, file),
        tabs(await readFile(join('apps/mobile/maestro', file), 'utf8')),
      )
  const setup = (await readFile('apps/mobile/maestro/navigation.yaml', 'utf8'))
    .split('- assertVisible:')[0]
    .replace(
      '- tapOn:\n    id: Dismiss keyboard\n',
      '- swipe:\n    start: 50%, 55%\n    end: 50%, 30%\n    duration: 400\n',
    )
  let flow = remote
    ? setup +
      `- tapOn:\n    id: Task mobile-task\n- extendedWaitUntil:\n    visible: Make the mobile chat more compact.\n    timeout: 15000\n- waitForAnimationToEnd\n- takeScreenshot: mobile-smaller-chat\n- tapOn: Browser\n- extendedWaitUntil:\n    visible:\n      text: Go\n      enabled: true\n    timeout: 20000\n- tapOn: Host browser URL\n- inputText: http://127.0.0.1:${server.address().port}\n- tapOn: Go\n- extendedWaitUntil:\n    visible: '.*Remote browser page.*'\n    timeout: 20000\n- takeScreenshot: mobile-host-browser\n- tapOn: Keyboard\n- inputText: Native remote input\n- takeScreenshot: mobile-host-browser-keyboard\n- tapOn: Keyboard\n- tapOn: Close browser session\n- extendedWaitUntil:\n    visible: Reconnect\n    timeout: 15000\n- tapOn: Reconnect\n- extendedWaitUntil:\n    visible: Host browser URL\n    timeout: 15000\n- takeScreenshot: mobile-host-browser-reconnected\n`
    : setup +
      `- tapOn:\n    id: Task mobile-task\n- tapOn:\n    text: Browser\n- tapOn:\n    id: Browser mode\n- tapOn: Direct preview\n- tapOn:\n    id: Preview URL\n- eraseText\n- inputText: http://127.0.0.1:${server.address().port}\n- pressKey: Enter\n- extendedWaitUntil:\n    visible: Preview fixture\n    timeout: 15000\n- takeScreenshot: mobile-browser\n- tapOn:\n    id: Browser mode\n- tapOn: Simulators\n- scrollUntilVisible:\n    element:\n      text: '.*Dovo.*QA.*'\n    direction: DOWN\n    timeout: 30000\n- takeScreenshot: mobile-simulators\n`
  if (liveSimulator) {
    const liveDevice = (await previewDevices()).devices.find((entry) => entry.id === liveSimulator)
    if (!liveDevice) throw new Error('Requested live simulator is not available')
    const deviceLabel = JSON.stringify(
      liveDevice.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · booted',
    )
    flow += `- tapOn:\n    id: Browser mode\n- tapOn: Simulators\n- extendedWaitUntil:\n    visible:\n      id: Simulator ${liveSimulator}\n    timeout: 20000\n- tapOn:\n    text: Live preview\n    below:\n      text: ${deviceLabel}\n    index: 0\n- extendedWaitUntil:\n    visible: '.*Live simulator screen.*'\n    timeout: 20000\n- tapOn: Home\n- waitForAnimationToEnd\n- takeScreenshot: mobile-live-simulator\n`
  }
  await writeFile(join(directory, 'preview.yaml'), tabs(flow))
  const child = spawn(
    'maestro',
    [
      '--device',
      device,
      'test',
      '--test-output-dir',
      resolve('work/design/device-preview/mobile'),
      '-e',
      `RUNTIME_ADDRESS=http://127.0.0.1:${runtime.port}`,
      '-e',
      `PAIRING_CODE=${code}`,
      join(directory, 'preview.yaml'),
    ],
    { stdio: 'inherit' },
  )
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (exit !== 0) throw new Error(`Preview UI failed (${exit})`)
  if (remote) console.log('Browser verification input:', JSON.stringify({ visits, browserInputs }))
  if (remote && !typed.includes('Native remote input'))
    throw new Error('Native keyboard text did not reach the host field: ' + JSON.stringify(typed))
  if (remote && !visits.includes('/')) throw new Error('The host browser did not reach the fixture')
  console.log(
    remote
      ? 'PASS: native mobile host browser loads, displays canvas, opens keyboard and reconnects'
      : 'PASS: mobile browser loads and simulator controls list host devices',
  )
} finally {
  clearInterval(approve)
  server.close()
  await runtime.close()
  await rm(directory, { recursive: true, force: true })
}
