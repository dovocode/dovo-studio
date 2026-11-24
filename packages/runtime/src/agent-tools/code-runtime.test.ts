import { expect, it, vi } from 'vite-plus/test'
import { runToolCode } from './code-runtime.js'
import { CodeResults } from './code-results.js'

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
it('retains excess parallel tool results before they can fill the QuickJS heap', async () => {
  const text = 'a'.repeat(2_500_000)
  const result = await runToolCode({
    signal,
    code: `
const results = await Promise.all(Array.from({length:4},()=>tools.dovo.studio_threads({})));
return results.map(result=>result.text?.length??result.retained);`,
    call: async () => ({ text }),
    retainResult: () => ({ retained: true }),
  })
  expect(result.result).toEqual([text.length, true, true, true])
})
it('charges compact previews to the cumulative guest input budget', async () => {
  const result = await runToolCode({
    signal,
    code: `
      await tools.dovo.example({ fill: true });
      await tools.dovo.example({ fill: true });
      await tools.dovo.example({});
      try { await tools.dovo.example({}); return 'over budget' }
      catch (error) { return error.message }
    `,
    call: async (call) =>
      'x'.repeat(
        call.arguments && typeof call.arguments === 'object' && 'fill' in call.arguments
          ? 2 * 1024 * 1024 - 2500
          : 10_000,
      ),
    retainResult: () => ({ retained: true, preview: 'x'.repeat(4096) }),
  })
  expect(result.result).toEqual(expect.stringContaining('Code mode input limit reached'))
})
it('parses a result near the 4 MiB limit and disposes the runtime', async () => {
  const bytes = 4 * 1024 * 1024 - 5000
  const result = await runToolCode({
    signal,
    code: `return (await tools.dovo.example({})).length`,
    call: async () => 'x'.repeat(bytes),
  })
  expect(result.result).toBe(bytes)
})
it('reports the recovery ID when a retained preview cannot fit in the guest', async () => {
  const store = new CodeResults()
  const value = { text: 'retained data'.repeat(1000) }
  const execution = runToolCode({
    signal,
    code: `await tools.dovo.fill({}); await tools.dovo.complete({});`,
    call: async (call) => (call.name === 'fill' ? 'x'.repeat(4 * 1024 * 1024 - 1024) : value),
    retainResult: (result) => store.retain('thread', result, 0, 0),
  })
  await expect(execution).rejects.toThrow(/read_tool_result.*resultId/)
  const message = await execution.catch((error: Error) => error.message)
  if (typeof message !== 'string') throw new Error('Expected a failed call')
  const resultId = /[0-9a-f-]{36}/.exec(message)?.[0]
  expect(store.read('thread', { resultId }, 0).text).toBe(JSON.stringify(value).slice(0, 8192))
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const execution = runToolCode({
      signal,
      timeoutMs: 20,
      code: `await tools.dovo.first({}); await tools.dovo.second({})`,
      call: async ({ name }) => {
        if (name === 'first') return {}
        markStarted()
        return new Promise(() => {})
      },
    })
    const outcome = execution.catch((error: unknown) => error)
    await started
    await vi.advanceTimersByTimeAsync(20)
    expect(await outcome).toMatchObject({
      message: expect.stringContaining('timed out'),
      callOutcomes: { completed: [1], unconfirmed: [2] },
    })
  } finally {
    vi.useRealTimers()
  }
})
