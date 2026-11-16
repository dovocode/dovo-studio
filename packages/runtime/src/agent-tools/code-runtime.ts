import { getQuickJS, type QuickJSDeferredPromise, type QuickJSHandle } from 'quickjs-emscripten'

const MAX_BYTES = 4 * 1024 * 1024
export type CodeCall = { source: string; name: string; server?: string; arguments?: unknown }
export type CodeExecution = { result: unknown; output: unknown[]; calls: number }

/** Fresh JavaScript heap. The only capabilities are the checked tool dispatcher and output. */
export async function runToolCode(options: {
  code: string
  call: (call: CodeCall, signal: AbortSignal) => Promise<unknown>
  signal: AbortSignal
  timeoutMs?: number
}): Promise<CodeExecution> {
  if (Buffer.byteLength(options.code) > 100_000) throw new Error('Code exceeds 100 KB')
  options.signal.throwIfAborted()
  const engine = await getQuickJS()
  options.signal.throwIfAborted()
  const runtime = engine.newRuntime()
  runtime.setMemoryLimit(64 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  const context = runtime.newContext()
  const controller = new AbortController()
  const signal = AbortSignal.any([options.signal, controller.signal])
  const deferred = new Set<QuickJSDeferredPromise>()
  const output: unknown[] = []
  let outputBytes = 0,
    calls = 0,
    active = 0,
    jobs = 0,
    cpuMs = 0,
    deadline = 0
  let closed = false,
    scheduled = false
  let script: QuickJSHandle | undefined
  let failure: Error | undefined
  let resolveExecution!: (value: CodeExecution) => void
  let rejectExecution!: (error: Error) => void
  const execution = new Promise<CodeExecution>((resolve, reject) => {
    resolveExecution = resolve
    rejectExecution = reject
  })
  const bounded = (value: unknown) => {
    const json = JSON.stringify(value ?? null)
    if (Buffer.byteLength(json) > MAX_BYTES) throw new Error('Tool code value exceeds 4 MB')
    return json
  }
  const stop = (error: Error) => {
    if (closed) return
    closed = true
    controller.abort(error)
    rejectExecution(error)
  }
  const abort = () => stop(new Error('Tool code cancelled. Earlier tool calls may have completed.'))
  options.signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    () => stop(new Error('Tool code timed out. Earlier tool calls may have completed.')),
    options.timeoutMs ?? 750_000,
  )
  runtime.setInterruptHandler(() => closed || signal.aborted || Date.now() > deadline)
  const run = <T>(operation: () => T) => {
    const start = Date.now()
    deadline = start + Math.max(0, 2000 - cpuMs)
    try {
      return operation()
    } finally {
      cpuMs += Date.now() - start
    }
  }
  function pump() {
    scheduled = false
    if (closed || !script) return
    try {
      if (cpuMs >= 2000 || jobs >= 10_000) throw new Error('Tool code exceeded its CPU budget')
      const result = run(() => runtime.executePendingJobs(100))
      if (result.error) {
        const error = new Error(`Tool code failed: ${JSON.stringify(context.dump(result.error))}`)
        result.dispose()
        throw error
      }
      jobs += result.value
      result.dispose()
      const state = context.getPromiseState(script)
      if (state.type === 'fulfilled') {
        const value: unknown = context.dump(state.value)
        state.value.dispose()
        if (!active && !runtime.hasPendingJob()) {
          if (failure) throw failure
          bounded(value)
          closed = true
          resolveExecution({ result: value, output, calls })
          return
        }
      } else if (state.type === 'rejected') {
        failure = new Error(`Tool code failed: ${JSON.stringify(context.dump(state.error))}`)
        state.error.dispose()
        // Wait for started calls to settle. Do not claim that a side effect was undone.
        if (!active) throw failure
      }
      if (runtime.hasPendingJob()) schedule()
      else if (!active) throw new Error('Tool code is waiting on a promise that cannot settle')
    } catch (error) {
      stop(error instanceof Error ? error : new Error(String(error)))
    }
  }
  function schedule() {
    if (closed || scheduled) return
    scheduled = true
    setImmediate(pump)
  }
  context
    .newFunction('__print', (value) => {
      const json = context.getString(value)
      outputBytes += Buffer.byteLength(json)
      if (outputBytes > MAX_BYTES || output.length >= 100)
        throw new Error('Tool code output limit exceeded')
      output.push(JSON.parse(json))
    })
    .consume((handle) => context.setProp(context.global, '__print', handle))
  context
    .newFunction('__call', (value) => {
      if (closed || signal.aborted) throw new Error('Tool code is no longer active')
      if (++calls > 100 || active >= 8)
        throw new Error('Tool code supports 100 calls and 8 concurrent calls')
      const call: CodeCall = JSON.parse(context.getString(value))
      const promise = context.newPromise()
      deferred.add(promise)
      active++
      void Promise.resolve()
        .then(() => options.call(call, signal))
        .then(
          (value) => {
            if (closed) return
            const handle = context.newString(bounded(value))
            promise.resolve(handle)
            handle.dispose()
          },
          (error: unknown) => {
            if (closed) return
            const handle = context.newError(error instanceof Error ? error.message : String(error))
            promise.reject(handle)
            handle.dispose()
          },
        )
        .catch((error: unknown) => stop(error instanceof Error ? error : new Error(String(error))))
        .finally(() => {
          active--
          schedule()
        })
      return promise.handle
    })
    .consume((handle) => context.setProp(context.global, '__call', handle))
  try {
    const source = `
const invoke = async (source,name,args,server) => JSON.parse(await __call(JSON.stringify({source,name,arguments:args,server})));
const namespace = (source,server) => new Proxy(Object.create(null), {get:(_,name)=>name==='then'?undefined:args=>invoke(source,String(name),args,server)});
globalThis.tools = Object.freeze({dovo:namespace('dovo'),harness:namespace('harness'),mcp:new Proxy(Object.create(null),{get:(_,server)=>namespace('mcp',String(server))}),search:args=>invoke('catalog','search',args)});
globalThis.print = (...values) => __print(JSON.stringify(values));
globalThis.data = result => {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  if (result?.content?.length===1 && result.content[0].type==='text') {
    try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
  }
  return result;
};
(async () => {${options.code}\n})()`
    script = run(() => context.unwrapResult(context.evalCode(source, 'tool-code.js')))
    schedule()
    return await execution
  } finally {
    closed = true
    clearTimeout(timeout)
    options.signal.removeEventListener('abort', abort)
    controller.abort()
    for (const promise of deferred) promise.dispose()
    script?.dispose()
    context.dispose()
    runtime.dispose()
  }
}
