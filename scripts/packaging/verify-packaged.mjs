import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { Either, Schema } from 'effect'
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
  const schema = Schema.Array(
    Schema.Struct({ type: Schema.String, webSocketDebuggerUrl: Schema.optional(Schema.String) }),
  )
  let page
  for (let i = 0; i < 100; i++) {
    page = Schema.decodeUnknownSync(schema)(
      await (await fetch(`http://${address.host}/json/list`)).json(),
    ).find((item) => item.type === 'page')
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
      const response = Schema.decodeUnknownSync(
        Schema.Struct({
          id: Schema.optional(Schema.Number),
          result: Schema.optional(Schema.Unknown),
          error: Schema.optional(Schema.Unknown),
        }),
      )(JSON.parse(String(event.data)))
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
  const exception = Schema.decodeUnknownEither(
    Schema.Struct({
      exceptionDetails: Schema.Struct({
        text: Schema.String,
        exception: Schema.optional(Schema.Struct({ description: Schema.String })),
      }),
    }),
  )(raw)
  if (Either.isRight(exception))
    throw new Error(
      exception.right.exceptionDetails.exception?.description ??
        exception.right.exceptionDetails.text,
    )
  const checked = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        value: Schema.Struct({
          owner: Schema.Literal(true),
          providers: Schema.Array(Schema.String).pipe(Schema.itemsCount(4)),
          connected: Schema.Literal(true),
        }),
      }),
    }),
  )(raw)
  console.log('Packaged application verified without system Node:', checked.result.value)
} finally {
  socket?.close()
  child.kill('SIGTERM')
  await finished
  clearTimeout(timeout)
  // Packaged Mac runtime ownership belongs to launchd, not the test's Electron child.
  const label = `com.dovo.studio.runtime.${createHash('sha256').update(data).digest('hex').slice(0, 16)}`
  const target = `gui/${process.getuid()}/${label}`
  let loaded = false
  try {
    execFileSync('/bin/launchctl', ['print', target], { stdio: 'pipe' })
    loaded = true
  } catch {
    /* Startup may have failed before provisioning its isolated test service. */
  }
  if (loaded) execFileSync('/bin/launchctl', ['bootout', target], { stdio: 'pipe', timeout: 40000 })
  await rm(join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`), { force: true })
  await rm(data, { recursive: true, force: true })
}
