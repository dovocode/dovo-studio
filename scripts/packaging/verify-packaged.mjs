import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { z } from 'zod'
const data = await mkdtemp(join(tmpdir(), 'dovo-packaged-check-'))
const binary = resolve('release/mac-arm64/Dovo Studio.app/Contents/MacOS/Dovo Studio')
const environment = {
  ...process.env,
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  DOVO_PORT: '0',
  DOVO_HOST: '127.0.0.1',
}
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(binary, [`--user-data-dir=${data}`, '--remote-debugging-port=0'], {
  cwd: tmpdir(),
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let diagnostics = '',
  socket
const finished = once(child, 'exit')
const timeout = setTimeout(() => child.kill('SIGKILL'), 30000)
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', (chunk) => {
      diagnostics += String(chunk)
      const found = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (found) resolve(found[1])
    })
    child.once('error', reject)
    child.once('exit', () => reject(new Error(diagnostics)))
  })
  const address = new URL(String(endpoint))
  const schema = z.array(
    z.object({ type: z.string(), webSocketDebuggerUrl: z.string().optional() }),
  )
  let page
  for (let i = 0; i < 100; i++) {
    page = schema
      .parse(await (await fetch(`http://${address.host}/json/list`)).json())
      .find((item) => item.type === 'page')
    if (page?.webSocketDebuggerUrl) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!page?.webSocketDebuggerUrl) throw new Error('Packaged renderer did not open')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const result = new Promise((resolve, reject) =>
    socket.addEventListener('message', (event) => {
      const response = z
        .object({
          id: z.number().optional(),
          result: z.unknown().optional(),
          error: z.unknown().optional(),
        })
        .parse(JSON.parse(String(event.data)))
      if (response.id === 1) {
        if (response.error) reject(new Error(JSON.stringify(response.error)))
        else resolve(response.result)
      }
    }),
  )
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async()=>{for(let i=0;i<100;i++){if(document.body?.innerText.includes('Workspace synced'))break;await new Promise(r=>setTimeout(r,100))}const c=await window.dovo.runtimeConnection();const r=await fetch(c.address+'/api/snapshot',{headers:{Authorization:'Bearer '+c.token}});const s=await r.json();if(!s.owner||!s.workspace.agents.length)throw new Error('Packaged owner connection failed');return {owner:s.owner,providers:s.workspace.agents.map(a=>a.provider),connected:document.body?.innerText.includes('Workspace synced')}})()`,
      },
    }),
  )
  const raw = await result
  const exception = z
    .object({
      exceptionDetails: z.object({
        text: z.string(),
        exception: z.object({ description: z.string() }).optional(),
      }),
    })
    .safeParse(raw)
  if (exception.success)
    throw new Error(
      exception.data.exceptionDetails.exception?.description ??
        exception.data.exceptionDetails.text,
    )
  const checked = z
    .object({
      result: z.object({
        value: z.object({
          owner: z.literal(true),
          providers: z.array(z.string()).length(4),
          connected: z.literal(true),
        }),
      }),
    })
    .parse(raw)
  console.log('Packaged application verified without system Node:', checked.result.value)
} finally {
  socket?.close()
  child.kill('SIGTERM')
  await finished
  clearTimeout(timeout)
  await rm(data, { recursive: true, force: true })
}
