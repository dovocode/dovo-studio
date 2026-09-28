import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
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
const timeout = setTimeout(() => {
  diagnostics += '\nPackaged application did not finish the smoke test within 60 seconds.'
  child.kill('SIGKILL')
}, 60000)
child.stdout.on('data', (chunk) => {
  diagnostics += String(chunk)
})
child.on('exit', (code, signal) => {
  diagnostics += `\nPackaged application exited (${signal ?? code}).`
})
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
    Schema.Struct({
      type: Schema.String,
      url: Schema.String,
      webSocketDebuggerUrl: Schema.optional(Schema.String),
    }),
  )
  let page
  for (let i = 0; i < 100; i++) {
    page = Schema.decodeUnknownSync(schema)(
      await (
        await fetch(`http://${address.host}/json/list`, { signal: AbortSignal.timeout(2000) })
      ).json(),
    ).find(
      (item) =>
        item.type === 'page' && item.url.startsWith('file:') && item.url.endsWith('/index.html'),
    )
    if (page?.webSocketDebuggerUrl) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!page?.webSocketDebuggerUrl) throw new Error('Packaged renderer did not open')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const result = new Promise((resolve, reject) => {
    const responseTimeout = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          `Packaged renderer did not answer DevTools within 20 seconds. ${diagnostics.slice(-2000)}`,
        ),
      )
    }, 20000)
    const cleanup = () => {
      clearTimeout(responseTimeout)
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('close', onClose)
      socket.removeEventListener('error', onError)
    }
    const onClose = () => {
      cleanup()
      reject(new Error(`Packaged renderer closed before replying. ${diagnostics.slice(-2000)}`))
    }
    const onError = (event) => {
      cleanup()
      reject(
        new Error(
          `Packaged renderer socket failed: ${event.message ?? ''} ${diagnostics.slice(-2000)}`,
        ),
      )
    }
    const onMessage = (event) => {
      const response = Schema.decodeUnknownSync(
        Schema.Struct({
          id: Schema.optional(Schema.Number),
          result: Schema.optional(Schema.Unknown),
          error: Schema.optional(Schema.Unknown),
        }),
      )(JSON.parse(String(event.data)))
      if (response.id === 1) {
        cleanup()
        if (response.error) reject(new Error(JSON.stringify(response.error)))
        else resolve(response.result)
      }
    }
    socket.addEventListener('message', onMessage)
    socket.addEventListener('close', onClose)
    socket.addEventListener('error', onError)
  })
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async()=>{
          const connected=()=>document.body?.innerText.includes('Workspace synced');
          for(let i=0;i<100&&!connected();i++)await new Promise(r=>setTimeout(r,100));
          if(!connected())throw new Error('Packaged renderer did not sync: '+document.body?.innerText.slice(0,300));
          const c=await Promise.race([
            window.dovo.runtimeConnection(),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error('Runtime connection timed out')),10000))
          ]);
          const r=await fetch(c.address+'/api/snapshot',{
            headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(10000)
          });
          const s=await r.json();
          if(!s.owner||!s.workspace.agents.length)throw new Error('Packaged owner connection failed');
          return {owner:s.owner,providers:s.workspace.agents.map(a=>a.provider),connected:connected()};
        })()`,
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
  const label = `com.dovo.studio.runtime.${createHash('sha256')
    .update(await realpath(data))
    .digest('hex')
    .slice(0, 16)}`
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
