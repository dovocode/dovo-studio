import { expect, it } from 'vite-plus/test'
import { runToolCode } from './code-runtime.js'

const signal = new AbortController().signal
it('composes tools across namespaces and returns only selected output', async () => {
  const calls: unknown[] = []
  const result = await runToolCode({
    signal,
    code: `
const catalog = await tools.search({query:'read'});
const results = await Promise.all([tools.harness.read_file({path:'a'}),tools.mcp.github.read({id:1})]);
print(catalog.length);
return results.map(result=>result.value);`,
    call: async (call) => {
      calls.push(call)
      return call.source === 'catalog' ? [{ name: 'read' }] : { value: call.source }
    },
  })
  expect(result).toEqual({ result: ['harness', 'mcp'], output: [[1]], calls: 3 })
  expect(calls).toContainEqual({
    source: 'mcp',
    server: 'github',
    name: 'read',
    arguments: { id: 1 },
  })
})
it('does not expose host filesystem, network, modules or environment', async () => {
  const result = await runToolCode({
    signal,
    code: `return [typeof process,typeof require,typeof fetch,typeof WebSocket,typeof Deno];`,
    call: async () => {
      throw Error('Unexpected call')
    },
  })
  expect(result.result).toEqual(Array(5).fill('undefined'))
})
it('propagates nested failures and supports explicit recovery', async () => {
  const options = {
    signal,
    call: async () => {
      throw Error('Read-only scope')
    },
  }
  await expect(
    runToolCode({ ...options, code: `await tools.harness.write_file({});` }),
  ).rejects.toThrow('Read-only scope')
  const result = await runToolCode({
    ...options,
    code: `try {await tools.harness.write_file({})}catch(error){return error.message}`,
  })
  expect(result.result).toBe('Read-only scope')
})
it('interrupts a synchronous loop without blocking later executions', async () => {
  await expect(
    runToolCode({ signal, code: `while(true){}`, call: async () => ({}) }),
  ).rejects.toThrow(/interrupt|budget/i)
  expect((await runToolCode({ signal, code: `return 42`, call: async () => ({}) })).result).toBe(42)
})
it('cancels active calls and rejects unknown promises and excessive concurrency', async () => {
  const controller = new AbortController()
  let nested: AbortSignal | undefined
  let startedResolve!: () => void
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve
  })
  const result = runToolCode({
    signal: controller.signal,
    code: `await tools.dovo.todos({action:'list'})`,
    call: async (_call, signal) => {
      nested = signal
      startedResolve()
      return new Promise(() => {})
    },
  })
  await started
  controller.abort()
  await expect(result).rejects.toThrow('cancelled')
  expect(nested?.aborted).toBe(true)
  await expect(
    runToolCode({ signal, code: `await new Promise(()=>{})`, call: async () => ({}) }),
  ).rejects.toThrow('cannot settle')
  await expect(
    runToolCode({
      signal,
      code: `await Promise.all(Array.from({length:9},()=>tools.dovo.todos({})))`,
      call: async () => ({}),
    }),
  ).rejects.toThrow('concurrent')
})
it('bounds output and wall time independently of tool waits', async () => {
  await expect(
    runToolCode({ signal, code: `print('x'.repeat(5*1024*1024))`, call: async () => ({}) }),
  ).rejects.toThrow('output limit')
  await expect(
    runToolCode({
      signal,
      timeoutMs: 20,
      code: `await tools.dovo.todos({})`,
      call: async () => new Promise(() => {}),
    }),
  ).rejects.toThrow('timed out')
})
