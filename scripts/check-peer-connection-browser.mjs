import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createServer as netServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { chromium, bundleBrowser } from './browser/harness.mjs'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { attachPeerSignaling } from '../apps/connect-server/dist/peer-signaling.js'
import { checkPeerUpgrades } from './browser/peer-upgrades.mjs'
import { checkPeerPairing } from './browser/peer-pairing.mjs'
import { dovoTurn } from '../apps/connect-server/dist/dovo-turn.js'
import { approvedRelayInstallations } from '../apps/connect-server/dist/relay-admission.js'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
async function run(relay, externalOrigin, forcedProtocol, attack, custom = false) {
  const provider =
    forcedProtocol === 'direct'
      ? undefined
      : (relay?.provider ?? (externalOrigin ? 'dovo' : undefined))
  const broker = createServer()
  let approvedKey
  broker.listen(0, '127.0.0.1')
  await once(broker, 'listening')
  process.env.DOVO_CONNECT_ORIGIN = externalOrigin ?? `http://127.0.0.1:${broker.address().port}`
  attachPeerSignaling(
    broker,
    [],
    relay && !custom ? { [relay.provider]: async () => relay } : {},
    (key, payload, signature) =>
      approvedKey === key && approvedRelayInstallations([key])(key, payload, signature),
    process.env.DOVO_CONNECT_ORIGIN,
  )
  if (relay) process.env.DOVO_PEER_RELAY_HOSTS = '127.0.0.1'
  else delete process.env.DOVO_PEER_RELAY_HOSTS
  const runtime = await startRuntime({
    databasePath: process.env.DOVO_TEST_PEER_DATABASE ?? ':memory:',
    ownerToken: 'browser-peer-owner',
    port: 0,
  })
  approvedKey = runtime.services.peers.relayIdentity().publicKey
  const credential = 'browser-phone-' + randomBytes(24).toString('hex')
  const device = runtime.services.devices.add('Phone browser', credential)
  if (custom) runtime.services.peers.relay.set(relay.iceServers[0])
  const issuedConfig = await runtime.services.peers.enable(device, provider)
  const config = { ...issuedConfig, ...(provider ? { relay: provider } : {}) }
  const built = await bundleBrowser(
    {
      stdin: {
        contents: `import {openPeerTunnel} from '${root}/apps/mobile/src/runtime/connection/peer-native.ts';window.openTunnel=openPeerTunnel;`,
        loader: 'ts',
        resolveDir: root,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      conditions: ['development'],
    },
    [
      {
        path: 'react-native-webrtc',
        contents: provider
          ? `export class RTCPeerConnection extends window.RTCPeerConnection {
              constructor(config){super(config);window.peerConnection=this}
              setConfiguration(config){
                const protocol=${JSON.stringify(forcedProtocol ?? null)};
                const iceServers=protocol ? config.iceServers.map(server=>({...server,
                  urls:[server.urls].flat().filter(url=>protocol==='tls'
                    ? url.startsWith('turns:')
                    : url.startsWith('turn:') && url.endsWith('transport='+protocol))
                })).filter(server=>server.urls.length) : config.iceServers;
                if(protocol && !iceServers.length)throw Error('Requested TURN protocol is not configured: '+protocol);
                super.setConfiguration({...config,iceServers,iceTransportPolicy:'relay'});
              }
            }`
          : `export class RTCPeerConnection extends window.RTCPeerConnection {constructor(config){super(config);window.peerConnection=this}}`,
      },
      {
        path: 'expo-crypto',
        contents:
          'export const getRandomBytesAsync=async count=>crypto.getRandomValues(new Uint8Array(count));',
      },
      // Only the native phone TCP boundary is adapted. SDP, ICE, DTLS, SCTP and the
      // production mobile negotiation/framing run in managed Chromium against werift.
      {
        path: 'react-native-tcp-socket',
        contents: `
    const encoder=new TextEncoder();
    export default {createServer(options,connection){
      let closed=false,listening=false;const listeners=new Map();
      const server={on(event,fn){listeners.set(event,fn)},once(event,fn){listeners.set(event,fn)},removeListener(event){listeners.delete(event)},close(){if(!listening)return;closed=true;window.tcpClosed=true},listen(options,callback){if(options.host!=='127.0.0.1')throw Error('Must bind loopback');const complete=()=>{listening=true;callback()};if(window.delayBinding){window.completeBinding=complete;window.bindingStarted=true}else complete()},address(){return {port:12345}}};
      window.tcpRoundTrip=raw=>new Promise((resolve,reject)=>{
        if(closed){reject(Error('Listener closed'));return}
        const events=new Map(),chunks=[];let pending=encoder.encode(raw),done=false;
        const socket={on(event,fn){events.set(event,fn)},write(bytes,encoding,callback){chunks.push(bytes);queueMicrotask(()=>callback())},pause(){},resume(){if(pending){const bytes=pending;pending=null;queueMicrotask(()=>events.get('data')?.(bytes))}},end(){done=true;resolve(new TextDecoder().decode(new Uint8Array(chunks.flatMap(chunk=>Array.from(chunk)))));events.get('close')?.()},destroy(){if(!done)reject(Error('Stream closed'));done=true},setNoDelay(){}};
        connection(socket);
      });return server;
    }};`,
      },
    ],
  )
  const browser = await chromium.launch({
    // Only the local TLS fixture uses a temporary self-signed certificate.
    args: relay && forcedProtocol === 'tls' ? ['--ignore-certificate-errors'] : [],
  })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${runtime.port}/health`)
    if (attack && !['binding-abort', 'native-open'].includes(attack))
      await page.evaluate((attack) => {
        const NativeWebSocket = window.WebSocket
        window.WebSocket = class extends NativeWebSocket {
          set onmessage(handler) {
            super.onmessage = (event) => {
              const value = JSON.parse(event.data)
              if (value.role === 'answer') {
                if (attack === 'fingerprint')
                  value.sdp = value.sdp.replace(
                    /a=fingerprint:sha-256 [^\r\n]+/i,
                    'a=fingerprint:sha-256 00:00',
                  )
                if (attack === 'session') value.session = '0'.repeat(64)
                if (attack === 'relay') value.relay = 'dovo'
                if (attack === 'mac') value.mac = '0'.repeat(64)
              }
              handler(new MessageEvent('message', { data: JSON.stringify(value) }))
            }
          }
        }
      }, attack)
    if (attack === 'native-open')
      await page.evaluate(() => {
        const NativePeer = window.RTCPeerConnection
        window.RTCPeerConnection = class extends NativePeer {
          createDataChannel(label, options) {
            const channel = super.createDataChannel(label, options)
            if (label !== 'dovo-tcp-v1') return channel
            // Model native synchronous creation: JS receives an open channel without
            // another open event. Buffer until Chromium's asynchronous DCEP completes.
            const queued = []
            channel.addEventListener('open', () => {
              for (const value of queued) channel.send(value)
              queued.length = 0
            })
            return new Proxy(channel, {
              get(target, key) {
                if (key === 'readyState') return 'open'
                if (key === 'send')
                  return (value) => {
                    if (target.readyState === 'open') target.send(value)
                    else queued.push(value)
                  }
                const value = Reflect.get(target, key, target)
                return typeof value === 'function' ? value.bind(target) : value
              },
              set(target, key, value) {
                if (key === 'onopen') return true
                return Reflect.set(target, key, value, target)
              },
            })
          }
        }
      })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    if (attack === 'binding-abort') {
      await page.evaluate((config) => {
        window.delayBinding = true
        window.bindingAbort = new AbortController()
        window.bindingResult = window
          .openTunnel(config, undefined, window.bindingAbort.signal)
          .then(
            () => 'resolved',
            () => 'rejected',
          )
      }, config)
      await page.waitForFunction(() => window.bindingStarted)
      assert.equal(
        await page.evaluate(async () => {
          window.bindingAbort.abort()
          return Promise.race([
            window.bindingResult,
            new Promise((resolve) => setTimeout(() => resolve('pending'), 1000)),
          ])
        }),
        'rejected',
      )
      await page.evaluate(() => window.completeBinding())
      assert.equal(await page.evaluate(() => window.tcpClosed), true)
      assert.equal(await page.evaluate(() => window.peerConnection.connectionState), 'closed')
      assert.deepEqual(errors, [])
      console.log(
        'Cancel during native TCP binding: promise rejected, peer closed and late listener closed.',
      )
      return
    }
    if (attack && attack !== 'native-open') {
      await assert.rejects(
        page.evaluate(async (config) => window.openTunnel(config), config),
        /identity could not be verified/,
      )
      assert.equal(await page.evaluate(() => typeof window.tcpRoundTrip), 'undefined')
      assert.equal(await page.evaluate(() => window.peerConnection.connectionState), 'closed')
      assert.deepEqual(errors, [])
      console.log(
        `Malicious signaling ${attack}: rejected before opening the HTTP tunnel; peer closed.`,
      )
      return
    }
    const opened = await page.evaluate(async (config) => {
      window.tunnel = await window.openTunnel(config)
      return { address: window.tunnel.address, alive: window.tunnel.alive() }
    }, config)
    assert.equal(opened.alive, true)
    assert.equal(opened.address, 'http://127.0.0.1:12345')
    const response = await page.evaluate(
      async ({ token, nativeOpen }) => {
        const response = window.tcpRoundTrip(
          'GET /api/snapshot HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ' +
            token +
            '\r\nConnection: close\r\n\r\n',
        )
        return nativeOpen
          ? Promise.race([
              response,
              new Promise((_, reject) =>
                setTimeout(() => reject(Error('Already-open native channel stalled')), 5000),
              ),
            ])
          : response
      },
      { token: credential, nativeOpen: attack === 'native-open' },
    )
    assert.match(response, /^HTTP\/1\.1 200/)
    assert.ok(response.includes(runtime.services.runtimeId))
    const unauthorized = await page.evaluate(async () =>
      window.tcpRoundTrip(
        'GET /api/snapshot HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
      ),
    )
    assert.match(unauthorized, /^HTTP\/1\.1 401/)
    const selected = await page.evaluate(async () => {
      const stats = await window.peerConnection.getStats()
      for (const report of stats.values()) {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          const pair = stats.get(report.selectedCandidatePairId)
          const local = stats.get(pair.localCandidateId)
          return { type: local.candidateType, relayProtocol: local.relayProtocol }
        }
      }
    })
    assert.ok(selected)
    if (provider) {
      assert.equal(selected.type, 'relay')
      if (forcedProtocol) assert.equal(selected.relayProtocol, forcedProtocol)
    } else assert.notEqual(selected.type, 'relay')
    await page.waitForFunction(() => window.tunnel.route() !== undefined)
    assert.equal(
      await page.evaluate(() => window.tunnel.route()),
      custom ? 'custom' : provider ? 'relay' : 'direct',
    )
    await page.evaluate(() => window.tunnel.close())
    assert.equal(await page.evaluate(() => window.tunnel.alive()), false)
    assert.equal(await page.evaluate(() => window.tunnel.route()), undefined)
    assert.deepEqual(errors, [])
    if (attack === 'native-open')
      console.log('Already-open native data channel: HTTP, authentication and teardown passed.')
    console.log(
      `${externalOrigin ? 'Public broker' : 'Local broker'} mobile ${provider ? 'forced TURN ' + selected.relayProtocol : 'direct'} transport: Chromium↔runtime WebRTC, signed SDP, HTTP, auth isolation and teardown passed (native TCP boundary adapted).`,
    )
  } finally {
    await browser.close()
    runtime.services.devices.revoke(device)
    await runtime.close()
    await new Promise((resolve) => broker.close(resolve))
  }
}
await run()
for (const attack of ['fingerprint', 'session', 'relay', 'mac', 'binding-abort'])
  await run(undefined, undefined, undefined, attack)
await run(undefined, undefined, undefined, 'native-open')
const pairingBrowser = await chromium.launch()
try {
  await checkPeerPairing(pairingBrowser, root)
  await checkPeerUpgrades(pairingBrowser, root)
} finally {
  await pairingBrowser.close()
}
if (process.env.DOVO_TEST_TURN_BINARY) {
  const availablePort = async () => {
    const reserve = netServer()
    reserve.listen(0, '127.0.0.1')
    await once(reserve, 'listening')
    const port = reserve.address().port
    await new Promise((resolve) => reserve.close(resolve))
    return port
  }
  const port = await availablePort()
  const tlsPort = await availablePort()
  const directory = await mkdtemp(join(tmpdir(), 'dovo-turn-'))
  const cert = join(directory, 'cert.pem')
  const key = join(directory, 'key.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'pipe' },
  )
  const roots = getCACertificates('default')
  setDefaultCACertificates([...roots, await readFile(cert, 'utf8')])
  const turn = spawn(
    process.env.DOVO_TEST_TURN_BINARY,
    [
      '-n',
      '--listening-ip=127.0.0.1',
      '--relay-ip=127.0.0.1',
      '--listening-port=' + port,
      '--tls-listening-port=' + tlsPort,
      '--cert=' + cert,
      '--pkey=' + key,
      '--min-port=53000',
      '--max-port=53100',
      '--realm=dovo-test',
      '--use-auth-secret',
      '--static-auth-secret=local-test-only-turn-secret-1234567890',
      '--allow-loopback-peers',
      '--no-multicast-peers',
      '--no-cli',
      '--no-tlsv1',
      '--no-tlsv1_1',
      '--no-dtls',
      '--no-stun',
      '--no-rfc5780',
      '--max-allocate-lifetime=600',
      '--relay-threads=1',
      '--pidfile=/tmp/dovo-test-turn-' + process.pid + '.pid',
      '--log-file=stdout',
      '--simple-log',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  turn.stdout.on('data', (chunk) => {
    output += chunk
  })
  turn.stderr.on('data', (chunk) => {
    output += chunk
  })
  try {
    // Readiness is an actual TCP connection, with an overall bounded wait.
    const { connect } = await import('node:net')
    const deadline = Date.now() + 10000
    await new Promise((resolve, reject) => {
      const attempt = () => {
        const socket = connect({ host: '127.0.0.1', port })
        socket.once('connect', () => {
          socket.destroy()
          resolve()
        })
        socket.once('error', () => {
          socket.destroy()
          if (Date.now() > deadline || turn.exitCode !== null)
            reject(Error('TURN fixture failed: ' + output))
          else setTimeout(attempt, 50)
        })
      }
      attempt()
    })
    for (const transport of ['udp', 'tcp', 'tls']) {
      const issue = dovoTurn({
        urls: [
          transport === 'tls'
            ? 'turns:127.0.0.1:' + tlsPort + '?transport=tcp'
            : 'turn:127.0.0.1:' + port + '?transport=' + transport,
        ],
        secret: 'local-test-only-turn-secret-1234567890',
      })
      await run(await issue('test-room-' + transport, '127.0.0.1'), undefined, transport)
      await run(
        { ...(await issue('custom-room-' + transport, '127.0.0.1')), provider: 'custom' },
        undefined,
        transport,
        undefined,
        true,
      )
    }
  } finally {
    turn.kill()
    await once(turn, 'exit')
    setDefaultCACertificates(roots)
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.env.DOVO_TEST_CONNECT_ORIGIN) {
  const protocols = (process.env.DOVO_TEST_CONNECT_MODES ?? 'direct,udp,tcp,tls').split(',')
  assert.ok(protocols.every((value) => ['direct', 'udp', 'tcp', 'tls'].includes(value)))
  for (const protocol of protocols)
    await run(undefined, process.env.DOVO_TEST_CONNECT_ORIGIN, protocol)
}
