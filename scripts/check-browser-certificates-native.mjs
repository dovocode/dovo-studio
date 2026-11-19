import { execFileSync, execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { promisify } from 'node:util'

const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const require = createRequire(join(desktop, 'package.json'))
const directory = await mkdtemp(join(tmpdir(), 'dovo-page-cert-'))
const servers = []
try {
  const listen = async (server, scheme) => {
    servers.push(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return scheme + '://127.0.0.1:' + server.address().port
  }
  const serveTLS = async (name, body) => {
    const keyPath = join(directory, name + '.key')
    const certPath = join(directory, name + '.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=' + name,
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    )
    const cert = await readFile(certPath)
    let pageLoads = 0
    const server = createServer({ key: await readFile(keyPath), cert }, (req, res) => {
      if (req.url.startsWith('/page.js')) {
        res.setHeader('content-type', 'text/javascript')
        return res.end('')
      }
      if (req.url === '/separate') {
        res.writeHead(200, { 'content-type': 'text/html', connection: 'close' })
        return res.end('<script src="/page.js?separate"></script>')
      }
      if (req.url === '/') pageLoads++
      res.setHeader('content-type', 'text/html')
      res.end(body)
    })
    return {
      origin: await listen(server, 'https'),
      fingerprint: new X509Certificate(cert).fingerprint256,
      pageLoads: () => pageLoads,
    }
  }
  const child = await serveTLS('frame', '<p>Frame</p>')
  const untrusted = await serveTLS('untrusted', '<p>Untrusted</p>')
  const site = await serveTLS(
    'page',
    '<script src="/page.js"></script><iframe src="' + child.origin + '"></iframe>',
  )
  const http = await listen(
    createHttpServer((req, res) => {
      if (req.url === '/redirect') res.writeHead(302, { location: site.origin })
      res.end('HTTP')
    }),
    'http',
  )
  const entry = join(directory, 'main.cjs')
  await build({
    stdin: {
      resolveDir: desktop,
      loader: 'ts',
      contents: `
      import { app, BrowserWindow } from 'electron'
      import assert from 'node:assert/strict'
      import { X509Certificate } from 'node:crypto'
      import { observeBrowserCertificate } from './electron/browser-certificate'
      import { createBrowserCdp, retainBrowserDebugger } from './electron/browser-cdp'
      import { desktopBrowserCommand, desktopBrowserList } from '../../packages/runtime/src/previews/desktop-browser'
      app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
      let stage = 'Opening the HTTPS main document'
      app.whenReady().then(async () => {
        const window = new BrowserWindow({show:false,webPreferences:{sandbox:true}})
        const contents = window.webContents
        // Trust only the fixture certificates in this temporary Electron session.
        const fingerprints = ${JSON.stringify([site.fingerprint, child.fingerprint])}
        contents.session.setCertificateVerifyProc((req, cb) =>
          cb(req.hostname === '127.0.0.1' && fingerprints.includes(new X509Certificate(req.certificate.data).fingerprint256) ? 0 : -3))
        const read = observeBrowserCertificate(contents)
        await contents.loadURL(${JSON.stringify(site.origin)})
        const snapshot = await read(${JSON.stringify(site.origin)})
        assert.equal(snapshot.origin,${JSON.stringify(site.origin)})
        let complete = 0
        const checkLeaf = (result, name, fingerprint) => {
          if (result.chain.length) {
            complete++
            assert.equal(result.chain[0].fingerprint256, fingerprint)
            assert.equal(result.chain[0].subject, 'CN='+name)
            assert.equal(result.chain[0].subjectAltName, 'IP Address:127.0.0.1')
          } else {
            assert.equal(result.leaf.subject, name)
            assert.equal(result.leaf.issuer, name)
            assert.equal(result.leaf.subjectAltName, '127.0.0.1')
            assert.ok(result.leaf.validFrom && result.leaf.validTo)
          }
          assert.ok(result.protocol && result.cipher)
        }
        checkLeaf(snapshot, 'page', ${JSON.stringify(site.fingerprint)})
        assert.equal(contents.debugger.isAttached(),false)
        stage = 'Reading the current page through agent access'
        process.env.DOVO_RELEASE_DISTRIBUTION='desktop'
        process.env.DOVO_DATABASE_PATH=${JSON.stringify(join(directory, 'fixture.sqlite'))}
        const host=await createBrowserCdp(${JSON.stringify(directory)})
        host.register('fixture','studio:browser','work',contents,'fixture',read)
        host.register('private','studio:browser','private-00000000-0000-4000-8000-000000000001',contents,'private',read)
        assert.deepEqual((await desktopBrowserList()).map(tab=>[tab.id,tab.certificateSupported]),[['desktop:fixture',true]])
        const inspect = id => desktopBrowserCommand(id,{action:'certificate'},()=>{})
        checkLeaf((await inspect('desktop:fixture')).certificate, 'page', ${JSON.stringify(site.fingerprint)})
        await assert.rejects(inspect('desktop:private'), /not found/i)
        stage = 'Navigating to a previous iframe origin'
        await contents.loadURL(${JSON.stringify(child.origin)})
        checkLeaf(await read(${JSON.stringify(child.origin)}), 'frame', ${JSON.stringify(child.fingerprint)})
        await assert.rejects(read(${JSON.stringify(site.origin)}), /page changed/i)
        stage = 'Navigating to HTTP'
        await contents.loadURL(${JSON.stringify(http)})
        await assert.rejects(read(${JSON.stringify(http)}), /no certificate/i)
        await assert.rejects(inspect('desktop:fixture'), /no TLS certificate/i)
        stage = 'Following an HTTP redirect to the HTTPS main document'
        await contents.loadURL(${JSON.stringify(http + '/redirect')})
        checkLeaf(await read(${JSON.stringify(site.origin)}), 'page', ${JSON.stringify(site.fingerprint)})
        stage = 'Reloading the same URL'
        const reloaded = new Promise(resolve=>contents.once('did-finish-load', resolve))
        contents.reload()
        await reloaded
        checkLeaf(await read(${JSON.stringify(site.origin)}), 'page', ${JSON.stringify(site.fingerprint)})
        stage = 'Distinguishing resources on separate TLS connections at one origin'
        await contents.loadURL(${JSON.stringify(site.origin + '/separate')})
        const partial = await read(${JSON.stringify(site.origin)})
        checkLeaf(partial, 'page', ${JSON.stringify(site.fingerprint)})
        assert.equal(partial.chain.length, 0)
        assert.equal('fingerprint256' in partial.leaf, false)
        stage = 'Handling a missing Chromium certificate chain'
        const send = contents.debugger.sendCommand.bind(contents.debugger)
        // Keep the main document and TLS metadata real. Reproduce Chromium's empty DER response.
        contents.debugger.sendCommand = (method,...args) => method==='Network.getCertificate'
          ? Promise.resolve({tableNames:[]}) : send(method,...args)
        await contents.loadURL(${JSON.stringify(child.origin + '/no-chain')})
        const missing = await read(${JSON.stringify(child.origin)})
        assert.equal(missing.chain.length,0)
        checkLeaf(missing, 'frame', ${JSON.stringify(child.fingerprint)})
        contents.debugger.sendCommand = send
        stage = 'Replacing a page during a certificate read'
        let entered, resume
        const enteredFrameRead = new Promise(resolve=>entered=resolve)
        const resumeFrameRead = new Promise(resolve=>resume=resolve)
        // Delay one actual Chromium reply so the replacement commits before it reaches the observer.
        contents.debugger.sendCommand = async (method,...args) => {
          const result = await send(method,...args)
          if(method==='Page.getFrameTree') {
            contents.debugger.sendCommand = send
            entered()
            await resumeFrameRead
          }
          return result
        }
        await contents.loadURL(${JSON.stringify(site.origin + '/race')})
        await enteredFrameRead
        const stale = read(${JSON.stringify(site.origin)})
        await contents.loadURL(${JSON.stringify(child.origin)})
        resume()
        await assert.rejects(stale, /page changed/i)
        checkLeaf(await read(${JSON.stringify(child.origin)}), 'frame', ${JSON.stringify(child.fingerprint)})
        stage = 'Preserving a connected debugger'
        const releaseAgent = retainBrowserDebugger(contents.debugger)
        await send('Network.enable', { maxTotalBufferSize: 1024, maxResourceBufferSize: 512 })
        contents.debugger.sendCommand = (method,...args) => {
          if(method==='Network.enable') assert.ok(args[1], 'The observer uses a separate Network session')
          return send(method,...args)
        }
        await contents.loadURL(${JSON.stringify(child.origin + '/shared-debugger')})
        checkLeaf(await read(${JSON.stringify(child.origin)}), 'frame', ${JSON.stringify(child.fingerprint)})
        assert.ok(contents.debugger.isAttached(), 'The other debugger remains attached')
        contents.debugger.sendCommand = send
        releaseAgent()
        stage = 'Rejecting the untrusted replacement page'
        await assert.rejects(contents.loadURL(${JSON.stringify(untrusted.origin)}), /ERR_CERT/)
        await assert.rejects(read(${JSON.stringify(untrusted.origin)}))
        assert.ok(complete > 0, 'At least one real Chromium chain supplied the expected fingerprint')
        await host.close()
        app.exit(0)
      }).catch(cause=>{
        console.error(stage, cause)
        app.exit(1)
      })
    `,
    },
    bundle: true,
    platform: 'node',
    external: ['electron'],
    outfile: entry,
    conditions: ['development'],
  })
  await promisify(execFile)(require('electron'), [entry], { timeout: 20000 })
  if (site.pageLoads() !== 3)
    throw new Error('Inspecting the page made another main-document request.')
  console.log(
    'Electron inspected the main TLS response, handled redirects and same-URL reloads, preserved fields across missing or ambiguous chains, and rejected HTTP, untrusted and replaced documents.',
  )
} finally {
  for (const server of servers) server.close()
  await rm(directory, { recursive: true, force: true })
}
