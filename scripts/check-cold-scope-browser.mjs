import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { WebSocketServer } from 'ws'
import { chromium } from './browser/harness.mjs'

// Real local HTTP and WebSocket boundaries exercise the cold scope and route resolver
// together. These fixtures never start a Dovo runtime or contact a provider.
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const runtimeId = 'scope-cold-paired-runtime'
const token = 'scope-cold-paired-device-token'
const requests = []
const upgrades = []
const tickets = new Map()
const usedTickets = new Set()
const sockets = new Set()
let identityUnavailable = true
const baseline = {
  revision: 1,
  runtimeId,
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    repositories: [],
    tasks: [],
    automations: [],
  },
  approvals: [],
  questions: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
  owner: false,
}
const websocket = new WebSocketServer({ noServer: true })
websocket.on('connection', (socket) => {
  socket.on('message', (data) => {
    if (JSON.parse(String(data)).type === 'resume')
      socket.send(
        JSON.stringify({
          type: 'snapshot',
          epoch: 'paired-epoch',
          sequence: 7,
          tag: 'baseline',
          snapshot: baseline,
        }),
      )
  })
})
const servers = ['wrong', 'proxy', 'vpn'].map((name) => {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://fixture').pathname
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.end()
      return
    }
    requests.push({
      name,
      path,
      method: request.method,
      authorization: request.headers.authorization,
    })
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<div id="app"></div>')
      return
    }
    response.setHeader('Content-Type', 'application/json')
    if (path === '/health') {
      response.end(
        JSON.stringify({
          service: 'dovo-runtime',
          runtimeId: name === 'wrong' ? 'other-runtime' : runtimeId,
        }),
      )
      return
    }
    const credential = request.headers.authorization?.replace(/^Bearer /, '')
    if (![token, token + ':error', token + ':stall'].includes(credential)) {
      response.writeHead(401).end(JSON.stringify({ error: 'Pair this device' }))
      return
    }
    if (name === 'vpn' && path === '/api/scm/source/identity' && identityUnavailable) {
      identityUnavailable = false
      response.writeHead(503).end('Runtime reconnecting')
      return
    }
    if (path === '/api/sync/ticket') {
      const ticket = name + '-' + tickets.size
      tickets.set(ticket, { name, credential })
      response.end(JSON.stringify({ ticket, format: 5 }))
    } else response.end(JSON.stringify({ ok: true }))
  })
  server.on('upgrade', (request, socket, head) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const ticket = new URL(request.url, 'http://fixture').searchParams.get('ticket')
    const issued = tickets.get(ticket)
    upgrades.push({ name, ticket })
    if (!issued || issued.name !== name || usedTickets.has(ticket)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    usedTickets.add(ticket)
    if (name === 'proxy' && issued.credential.endsWith(':stall')) return
    if (name !== 'vpn') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    websocket.handleUpgrade(request, socket, head, (client) =>
      websocket.emit('connection', client, request),
    )
  })
  return server
})

let browser
try {
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))),
  )
  const addresses = servers.map((server) => {
    const bound = server.address()
    assert.ok(bound && typeof bound !== 'string')
    return 'http://127.0.0.1:' + bound.port
  })
  const [wrong, proxy, vpn] = addresses
  const connection = { address: wrong, runtimeId, alternateAddresses: [vpn], token }
  const bundle = await build({
    stdin: {
      loader: 'tsx',
      resolveDir: root,
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect,Schema} from 'effect';
import {WorkspaceValueProvider} from '${root}/packages/studio-core/src/workspace/selector';
import {useWorkspace} from '${root}/packages/studio-core/src/workspace/context';
import {WorkspaceScope} from '${root}/packages/studio-core/src/workspace/scope';
import {runtimeRequest,runtimeRequestEffect} from '${root}/packages/protocol/src/shared/client';
import {startRuntimeSync} from '${root}/packages/protocol/src/runtime/connection/live-sync';
const connection=${JSON.stringify(connection)};
const profile={id:'owner',name:'Paired owner',connection};
window.owners=[];window.patches=[];window.frames=[];
const ok=Schema.Struct({ok:Schema.Boolean});
function Panel(){const value=useWorkspace(),[result,setResult]=useState('');
 return <section><p>{value.connection.runtimeId}</p><button onClick={async()=>{try{await value.request('/api/scm/source/identity',{repositoryId:'source'},ok);setResult('Read on verified owner')}catch(error){setResult(error.message)}}}>Read</button>
 <button onClick={async()=>{try{await value.request('/api/workspace',{name:'fixture'},ok,'PATCH');setResult('Patched verified owner')}catch(error){setResult(error.message)}}}>Patch</button><p role="status">{result}</p></section>}
const rootValue={activeRuntimeId:'other',runtimes:[{profile,snapshot:null,connected:false,error:null}],workspace:${JSON.stringify(baseline.workspace)},
 readRuntimeEffect:(owner,path,input,schema,method)=>{window.owners.push(owner);return runtimeRequestEffect(owner.connection,owner.connection.address,path,input,schema,method)},
 runtimeReadCache:()=>null,refreshRuntime:async owner=>window.patches.push(owner),setWorkspace:()=>{},pendingMessages:()=>[],syncConflicts:[]};
createRoot(document.getElementById('app')).render(<WorkspaceValueProvider value={rootValue}><WorkspaceScope profile={profile}><Panel/></WorkspaceScope></WorkspaceValueProvider>);
Math.random=()=>0.5;const now=Date.now;let offset=0;Date.now=()=>now()+offset;
window.expireHandshake=()=>{offset+=10000};
window.startStream=mode=>{window.sync?.stop();window.frames=[];window.streamConnection={address:${JSON.stringify(proxy)},alternateAddresses:[${JSON.stringify(wrong)},${JSON.stringify(vpn)}],runtimeId:${JSON.stringify(runtimeId)},token:${JSON.stringify(token)}+':'+mode};
 window.sync=startRuntimeSync(window.streamConnection,{onSnapshot:snapshot=>window.frames.push(snapshot)});};
window.httpMutation=()=>runtimeRequest(window.streamConnection,window.streamConnection.address,'/api/scm/pulls/action',{},ok);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + '/node_modules'],
  })
  browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(wrong)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Read on verified owner' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.owners[0].connection), connection)
  assert.ok(
    requests.some(
      (request) => request.name === 'vpn' && request.path === '/api/scm/source/identity',
    ),
  )
  assert.equal(
    requests.filter(
      (request) => request.name === 'vpn' && request.path === '/api/scm/source/identity',
    ).length,
    2,
  )
  assert.equal(
    requests.some((request) => request.name === 'wrong' && request.authorization),
    false,
  )
  assert.equal(
    requests
      .filter((request) => request.path === '/health')
      .every((request) => !request.authorization),
    true,
  )
  await page.getByRole('button', { name: 'Patch', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Patched verified owner' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.patches[0].connection), connection)

  for (const mode of ['error', 'stall']) {
    const previous = upgrades.length
    await page.evaluate((mode) => window.startStream(mode), mode)
    await page.waitForFunction(() => !!window.sync)
    if (mode === 'stall') {
      // Advance only the fixture's time source; the real socket's upgrade remains pending.
      await assertEventually(() => assert.equal(upgrades.length, previous + 1))
      await page.evaluate(() => window.expireHandshake())
    }
    await page.waitForFunction(() => window.sync.online())
    const attempts = upgrades.slice(previous)
    assert.deepEqual(
      attempts.map((attempt) => attempt.name),
      ['proxy', 'vpn'],
    )
    assert.notEqual(attempts[0].ticket, attempts[1].ticket)
    assert.equal(await page.evaluate(() => window.frames.length), 1)
    assert.equal(await page.evaluate(() => window.streamConnection.address), proxy)
    await page.evaluate(() => window.httpMutation())
    assert.equal(requests.at(-1).name, 'proxy')
    assert.equal(requests.at(-1).path, '/api/scm/pulls/action')
    await page.evaluate(() => window.sync.stop())
  }
  assert.equal(requests.filter((request) => request.path === '/api/scm/pulls/action').length, 2)
  assert.equal(
    requests.some((request) => request.name === 'wrong' && request.authorization),
    false,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Cold scope preserves and verifies saved runtime/VPN metadata, with a real 503→success POST read; blocked/stalled WebSocket upgrades use fresh tickets on the verified VPN while HTTP mutations stay single-dispatch on the proxy.',
  )
} finally {
  await browser?.close()
  for (const socket of sockets) socket.destroy()
  for (const client of websocket.clients) client.terminate()
  await new Promise((resolve) => websocket.close(resolve))
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections()
          server.close(resolve)
        }),
    ),
  )
}

async function assertEventually(check) {
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
}
