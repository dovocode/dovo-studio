import assert from 'node:assert/strict'
import { build as viteBuild } from 'vite-plus'
import { build as bundle } from 'esbuild'
import { chromium } from 'playwright'
import { WebSocketServer } from 'ws'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cpus, release } from 'node:os'

// Linux /proc PSS accounts for shared pages once. CDP CPU includes the browser,
// renderers (and their workers), GPU and utility processes. No Node/server CPU.
assert.equal(process.platform, 'linux', 'PSS measurement requires Linux /proc')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const variants = (
  process.env.TERMINAL_BENCH_VARIANTS ?? 'xterm-5000,canvas2d,webgl2,xterm-matched'
).split(',')
assert.ok(
  variants.length > 0 &&
    variants.every((v) => ['xterm-5000', 'canvas2d', 'webgl2', 'xterm-matched'].includes(v)),
)
const content = process.env.TERMINAL_BENCH_CONTENT ?? 'repeated'
assert.ok(['repeated', 'varied'].includes(content))
const temporary = await mkdtemp(join(root, '.terminal-resource-benchmark-'))
const repeats = Number(process.env.TERMINAL_BENCH_REPEATS ?? 3)
assert.ok(Number.isInteger(repeats) && repeats > 0)
const output =
  process.env.TERMINAL_BENCH_OUTPUT ?? join(root, 'scripts/benchmarks/terminal-resources.json')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const replay = Array.from(
  { length: 16000 },
  (_, i) => `line-${i}: \x1b[32mλ 漢字 🙂 output\x1b[0m\r\n`,
).join('')
const line = 'stream: \x1b[36mλ 漢字 🙂 batch output 0123456789\x1b[0m\r\n'
const chunk = line.repeat(Math.floor(16384 / Buffer.byteLength(line)))
const variedChunks =
  content === 'varied'
    ? Array.from({ length: 96 }, (_, n) =>
        Array.from({ length: chunk.length / line.length }, (_, row) =>
          line
            .replace(
              '0123456789',
              (n * (chunk.length / line.length) + row).toString(16).padStart(10, '0'),
            )
            .replace('[36m', '[' + (31 + ((n + row) % 6)) + 'm'),
        ).join(''),
      )
    : undefined
for (const data of variedChunks ?? [])
  assert.equal(Buffer.byteLength(data), Buffer.byteLength(chunk))
const peers = new Map()
const sockets = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await once(sockets, 'listening')
let server
let activeBrowser
try {
  await bundle({
    entryPoints: [join(root, 'packages/runtime/src/terminal/binary-stream.ts')],
    outfile: join(temporary, 'stream.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['ws'],
    alias: { '@dovo/protocol': join(root, 'packages/protocol/src/terminal-stream.ts') },
    logLevel: 'silent',
  })
  const { BinaryTerminalStream } = await import(pathToFileURL(join(temporary, 'stream.mjs')).href)
  sockets.on('connection', (socket, request) => {
    const url = new URL(request.url, 'http://localhost')
    const binary = url.searchParams.get('binary') === 'true'
    const peer = {
      socket,
      binary,
      expected: 0,
      consumed: 0,
      stream: binary ? new BinaryTerminalStream(socket) : undefined,
    }
    peers.set(url.searchParams.get('id'), peer)
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.type === 'ack') {
        peer.consumed += message.bytes
        peer.stream.ack(message.bytes)
      }
      if (message.type === 'ping') peer.stream?.pong(message.nonce)
    })
    socket.on('close', () => peer.stream?.stop())
    if (binary) peer.stream.replay('')
  })
  await writeFile(
    join(temporary, 'index.html'),
    '<!doctype html><style>html,body{margin:0;background:#101113}.pane{height:300px;width:800px}</style><script type="module" src="/fixture.js"></script>',
  )
  await writeFile(
    join(temporary, 'blank.html'),
    '<!doctype html><body style="background:#101113"></body>',
  )
  await writeFile(
    join(temporary, 'fixture.js'),
    `
window.errors=[];window.sessions=[];
window.create=async function(engine,history,id){
 const host=document.createElement('div');host.className='pane';document.body.append(host);
 const session={host,consumed:0,frame:null};sessions.push(session);
 const url='ws://127.0.0.1:${sockets.address().port}/?id='+id+'&binary='+!engine.startsWith('xterm');
 if(engine.startsWith('xterm')){
  const {Terminal}=await import('../apps/mobile/node_modules/@xterm/xterm/lib/xterm.mjs');
  await import('../apps/mobile/node_modules/@xterm/xterm/css/xterm.css');
  const term=new Terminal({cols:109,rows:18,fontFamily:'monospace',fontSize:12,scrollback:history,theme:{background:'#101113',foreground:'#ededee'}});
  host.style.width='788px';term.open(host);session.term=term;
  const socket=new WebSocket(url);session.socket=socket;
  socket.onmessage=event=>term.write(event.data,()=>{session.consumed+=event.data.length});
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
 }else{
  const {BrowserTerminal}=await import('../packages/terminal/src/browser/index.ts');
  await import('../packages/terminal/src/browser/styles.css');
  const term=new BrowserTerminal({fontFamily:'monospace',fontSize:12,scrollbackBytes:16*1024*1024,renderer:engine,theme:{background:'#101113',foreground:'#ededee',cursor:'#eeeeee',selectionBackground:'#446688'}});
  session.term=term;term.onError=error=>errors.push(error.message);term.onViewport=frame=>session.frame=frame;
  term.open(host);await term.ready;session.abort=new AbortController();
  await new Promise(resolve=>term.connect(url,session.abort.signal,resolve).catch(error=>errors.push(error.message)));
 }
};
window.visible=(index,value)=>{const s=sessions[index];s.host.style.display=value?'block':'none';s.term.setVisible?.(value)};
window.stats=()=>sessions.map(s=>({renderer:s.term.renderer??'xterm-dom',history:s.frame?.history??s.term.buffer?.active.baseY,cols:s.frame?.cols??s.term.cols,rows:s.frame?.rows??s.term.rows}));
window.hasMarker=(index,marker)=>{const s=sessions[index];if(s.frame)return s.frame.lines.some(l=>l.text.includes(marker));const b=s.term.buffer?.active;if(!b)return false;for(let i=b.baseY;i<b.length;i++)if(b.getLine(i)?.translateToString().includes(marker))return true;return false};
window.dispose=()=>{for(const s of sessions){s.abort?.abort();s.socket?.close();s.term.dispose();s.host.remove()}sessions=[]};
`,
  )
  await viteBuild({
    configFile: false,
    root: temporary,
    logLevel: 'error',
    worker: { format: 'es' },
    build: {
      outDir: join(temporary, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: { main: join(temporary, 'index.html'), blank: join(temporary, 'blank.html') },
      },
    },
  })
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
  }
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname
      const data = await readFile(join(temporary, 'dist', path === '/' ? 'index.html' : path))
      response.setHeader(
        'Content-Type',
        mime[extname(path === '/' ? 'index.html' : path)] ?? 'application/octet-stream',
      )
      response.end(data)
    } catch {
      response.writeHead(404).end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  const results = []
  let gpu
  for (let repeat = 0; repeat < repeats; repeat++) {
    // Interleave order to reduce warm-host/order bias; every run gets a fresh browser.
    for (const variant of variants
      .slice(repeat % variants.length)
      .concat(variants.slice(0, repeat % variants.length))) {
      const browser = (activeBrowser = await chromium.launch({
        args: ['--enable-unsafe-swiftshader', '--js-flags=--expose-gc'],
      }))
      const page = await browser.newPage({
        viewport: { width: 1000, height: 600 },
        deviceScaleFactor: 1,
      })
      const cdp = await browser.newBrowserCDPSession()
      gpu ??= (await cdp.send('SystemInfo.getInfo')).gpu
      const pageErrors = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await page.goto(url + '/blank.html')
      await delay(300)
      const memory = async () => {
        await page.evaluate(() => globalThis.gc?.())
        for (const worker of page.workers()) await worker.evaluate(() => globalThis.gc?.())
        await delay(150)
        const { processInfo } = await cdp.send('SystemInfo.getProcessInfo')
        const values = await Promise.all(
          processInfo.map(async ({ id }) => {
            try {
              return Number(
                (await readFile(`/proc/${id}/smaps_rollup`, 'utf8')).match(/^Pss:\s+(\d+)/m)[1],
              )
            } catch (error) {
              if (error.code === 'ENOENT' || error.code === 'ESRCH') return 0
              throw error
            }
          }),
        )
        return values.reduce((a, b) => a + b, 0) / 1024
      }
      const cpu = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo
      const phase = async (name, work) => {
        const initial = await cpu()
        const last = new Map(initial.map((p) => [p.id, p.cpuTime]))
        let cpuSeconds = 0
        const cpuByProcessType = {}
        const sample = async () => {
          for (const p of await cpu()) {
            const delta = Math.max(0, p.cpuTime - (last.get(p.id) ?? 0))
            cpuSeconds += delta
            cpuByProcessType[p.type] = (cpuByProcessType[p.type] ?? 0) + delta
            last.set(p.id, p.cpuTime)
          }
        }
        let pending = Promise.resolve()
        const timer = setInterval(() => {
          pending = pending.then(sample)
        }, 100)
        const start = performance.now()
        try {
          await work()
        } finally {
          clearInterval(timer)
          await pending
        }
        await sample()
        const wallMs = performance.now() - start
        const result = {
          name,
          wallMs,
          cpuSeconds,
          cpuByProcessType,
          oneCorePercent: (cpuSeconds / (wallMs / 1000)) * 100,
          pssMiB: await memory(),
        }
        phases.push(result)
        return result
      }
      const phases = []
      const baselinePssMiB = await memory()
      const history = variant === 'xterm-matched' ? 12087 : 5000
      const runId = `${repeat}-${variant}`
      const id = (i) => `${runId}-${i}`
      const create = (i) =>
        page.evaluate(({ variant, history, id }) => window.create(variant, history, id), {
          variant,
          history,
          id: id(i),
        })
      const send = (i, text, isReplay = false) => {
        const p = peers.get(id(i))
        assert.ok(p)
        p.expected += p.binary ? Buffer.byteLength(text) : text.length
        if (p.binary) {
          if (isReplay) p.stream.replay(text)
          else p.stream.data(text)
        } else p.socket.send(text)
      }
      const consumed = async (indices) => {
        const deadline = performance.now() + 30000
        while (true) {
          const counts = await page.evaluate(() => sessions.map((s) => s.consumed))
          if (
            indices.every((i) => {
              const p = peers.get(id(i))
              return (p.binary ? p.consumed : counts[i]) === p.expected
            })
          )
            return
          assert.ok(performance.now() < deadline, 'terminal failed to consume all output')
          await delay(10)
        }
      }
      const marker = async (i, text) => {
        await page.waitForFunction(
          ({ i, text }) => window.hasMarker(i, text),
          { i, text },
          { polling: 10 },
        )
        // Both renderers receive time for their final scheduled paint.
        await delay(40)
      }
      await phase('init', async () => {
        await page.goto(url)
        await page.waitForFunction(() => !!window.create)
        await create(0)
        await delay(100)
      })
      await phase('replay', async () => {
        send(0, replay + 'REPLAY_END\r\n', true)
        await consumed([0])
        await marker(0, 'REPLAY_END')
      })
      const replayStats = await page.evaluate(() => window.stats())
      assert.equal(replayStats[0].cols, 109)
      assert.equal(replayStats[0].rows, 18)
      assert.equal(replayStats[0].history, variant === 'xterm-5000' ? 5000 : 12087)
      assert.equal(replayStats[0].renderer, variant.startsWith('xterm') ? 'xterm-dom' : variant)
      const stream = async (indices, name) => {
        // 96 equal chunks at 32 ms intervals, ~0.5 MiB/s per session for 3.072 s.
        const start = performance.now()
        for (let n = 0; n < 96; n++) {
          for (const i of indices) send(i, variedChunks?.[n] ?? chunk)
          await delay(Math.max(0, start + (n + 1) * 32 - performance.now()))
        }
        for (const i of indices) send(i, name + '\r\n')
        await consumed(indices)
      }
      await phase('visible-stream', async () => {
        await stream([0], 'VISIBLE_END')
        await marker(0, 'VISIBLE_END')
      })
      await phase('idle', () => delay(2000))
      await page.evaluate(() => window.visible(0, false))
      await delay(100)
      await phase('hidden-stream', () => stream([0], 'HIDDEN_END'))
      await page.evaluate(() => window.visible(0, true))
      await marker(0, 'HIDDEN_END')
      await phase('four-session-init-replay', async () => {
        for (let i = 1; i < 4; i++) {
          await create(i)
          await page.evaluate((i) => window.visible(i, false), i)
          send(i, replay + 'MULTI_END\r\n', true)
        }
        await consumed([1, 2, 3])
        await delay(40)
      })
      await phase('four-session-stream', async () => {
        await stream([0, 1, 2, 3], 'FOUR_END')
        await marker(0, 'FOUR_END')
      })
      // Show hidden sessions once to prove that retained data is correct.
      for (let i = 1; i < 4; i++) {
        await page.evaluate((i) => window.visible(i, true), i)
        await marker(i, 'FOUR_END')
        await page.evaluate((i) => window.visible(i, false), i)
      }
      const finalStats = await page.evaluate(() => window.stats())
      assert.equal(finalStats.length, 4)
      for (const stats of finalStats) {
        assert.equal(stats.renderer, variant.startsWith('xterm') ? 'xterm-dom' : variant)
        assert.equal(stats.cols, 109)
        assert.equal(stats.rows, 18)
        assert.ok(stats.history > 0)
      }
      assert.deepEqual(await page.evaluate(() => window.errors), [])
      assert.deepEqual(pageErrors, [])
      await page.evaluate(() => window.dispose())
      await delay(500)
      const disposedPssMiB = await memory()
      const result = {
        repeat,
        variant,
        baselinePssMiB,
        replayStats,
        finalStats,
        phases,
        disposedPssMiB,
      }
      results.push(result)
      console.log(JSON.stringify(result))
      await browser.close()
      activeBrowser = undefined
      for (let i = 0; i < 4; i++) peers.delete(id(i))
      await writeFile(
        output,
        JSON.stringify(
          {
            metadata: {
              timestamp: new Date().toISOString(),
              platform: process.platform,
              kernel: release(),
              cpu: cpus()[0].model,
              logicalCpus: cpus().length,
              node: process.version,
              chromium: browser.version(),
              repeats,
              content,
              scope:
                'Isolated production browser terminal client; whole-browser CPU and PSS; software GPU; no PTY/server/React/native mobile',
              geometry: { cols: 109, rows: 18, dpr: 1 },
              replayLines: 16000,
              replayBytes: Buffer.byteLength(replay + 'REPLAY_END\r\n'),
              stream: { chunks: 96, intervalMs: 32, bytesPerChunk: Buffer.byteLength(chunk) },
              gpu,
            },
            results,
          },
          null,
          2,
        ) + '\n',
      )
    }
  }
} finally {
  await activeBrowser?.close()
  for (const peer of peers.values()) peer.socket.terminate()
  await new Promise((resolve) => sockets.close(resolve))
  if (server) await new Promise((resolve) => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
