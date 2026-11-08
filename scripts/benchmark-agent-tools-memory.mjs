// Build @dovo/runtime and dependencies first. No runtime requests or real credentials are used.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const server = fileURLToPath(
  new URL('../packages/runtime/dist/agent-tools/server.js', import.meta.url),
)
async function measure(broad) {
  // Restore only the old import paths for the baseline; both processes execute the same bridge.
  const preload = `import { registerHooks } from 'node:module';
    ${broad ? `registerHooks({resolve(s,c,n){return n(s==='@dovo/protocol/agent-tools'?'@dovo/protocol':s==='@dovo/client-runtime/terminal-input'?'@dovo/client-runtime':s,c)}});` : ''}
    process.on('message',()=>{global.gc();process.send(process.memoryUsage())});`
  const start = performance.now()
  const child = spawn(
    process.execPath,
    ['--expose-gc', '--import', 'data:text/javascript,' + encodeURIComponent(preload), server],
    {
      env: {
        PATH: process.env.PATH,
        DOVO_TASK_ID: 'synthetic-memory-audit',
        DOVO_TASK_URL: 'http://127.0.0.1:9',
        DOVO_TASK_TOKEN: 'synthetic-audit-token-never-a-real-credential',
        DOVO_STUDIO_TOOLS: JSON.stringify({
          threads: true,
          automations: true,
          browsers: true,
          ui: true,
          diagnostics: true,
        }),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    },
  )
  try {
    return await new Promise((resolve, reject) => {
      let output = '',
        details
      const timer = setTimeout(() => reject(new Error('Bridge probe timed out')), 15_000)
      const fail = (error) => {
        clearTimeout(timer)
        reject(error)
      }
      child.once('error', fail)
      child.once('exit', (code) => fail(new Error(`Bridge exited before measurement: ${code}`)))
      // Drain diagnostics without exposing inherited environments or message content.
      child.stderr.resume()
      child.stdout.on('data', (chunk) => {
        output += chunk
        let end
        while ((end = output.indexOf('\n')) >= 0) {
          const line = output.slice(0, end)
          output = output.slice(end + 1)
          try {
            const message = JSON.parse(line)
            if (message.id !== 2) continue
            if (!Array.isArray(message.result?.tools)) throw new Error('Tools list is missing')
            details = {
              startupMs: performance.now() - start,
              tools: message.result.tools.length,
              schemaHash: createHash('sha256')
                .update(JSON.stringify(message.result.tools))
                .digest('hex'),
            }
            child.send('measure')
          } catch (error) {
            fail(error)
          }
        }
      })
      child.once('message', (memory) => {
        clearTimeout(timer)
        if (
          !details ||
          !memory ||
          typeof memory !== 'object' ||
          typeof memory.rss !== 'number' ||
          typeof memory.heapUsed !== 'number'
        ) {
          reject(new Error('Invalid memory measurement'))
          return
        }
        resolve({ ...details, rssMiB: memory.rss / 1048576, heapMiB: memory.heapUsed / 1048576 })
      })
      for (const message of [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'isolated-audit', version: '1' },
          },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ])
        child.stdin.write(JSON.stringify(message) + '\n')
    })
  } finally {
    child.kill()
  }
}
const samples = []
for (let index = 0; index < 3; index++)
  for (const broad of index % 2 ? [false, true] : [true, false])
    samples.push({
      imports: broad ? 'broad baseline' : 'narrow implementation',
      ...(await measure(broad)),
    })
assert.equal(new Set(samples.map((sample) => sample.schemaHash)).size, 1)
console.log(
  JSON.stringify(
    {
      scope:
        'Fresh Node processes; identical local initialize/tools-list; explicit GC; synthetic credentials; not whole-runtime memory or battery measurements',
      samples,
    },
    null,
    2,
  ),
)
