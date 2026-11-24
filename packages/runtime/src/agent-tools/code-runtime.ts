import { getQuickJS, type QuickJSDeferredPromise, type QuickJSHandle } from 'quickjs-emscripten'
import { codeFileAliases } from './code-catalog.js'

const MAX_BYTES = 4 * 1024 * 1024
export type CodeCall = { source: string; name: string; server?: string; arguments?: unknown }
export type CodeExecution = { result: unknown; output: unknown[]; calls: number }

type CallOutcomes = { completed: number[]; unconfirmed: number[] }

export class CodeExecutionError extends Error {
  constructor(
    cause: Error,
    readonly output: unknown[],
    readonly calls: number,
    readonly callOutcomes: CallOutcomes,
  ) {
    super(cause.message, { cause })
  }
}

/** Fresh JavaScript heap. The only capabilities are the checked tool dispatcher and output. */
export async function runToolCode(options: {
  code: string
  call: (call: CodeCall, signal: AbortSignal) => Promise<unknown>
  signal: AbortSignal
  timeoutMs?: number
  retainResult?: (value: unknown) => unknown
}): Promise<CodeExecution> {
  if (Buffer.byteLength(options.code) > 100_000) throw new Error('Code exceeds 100 KB')
  options.signal.throwIfAborted()
  const engine = await getQuickJS()
  options.signal.throwIfAborted()
  const runtime = engine.newRuntime()
  runtime.setMemoryLimit(64 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  const context = runtime.newContext()
  const parseJson = context
    .getProp(context.global, 'JSON')
    .consume((json) => context.getProp(json, 'parse'))
  const controller = new AbortController()
  const signal = AbortSignal.any([options.signal, controller.signal])
  const deferred = new Set<QuickJSDeferredPromise>()
  const ready: Array<() => void> = []
  const output: unknown[] = []
  const dispatched = new Map<number, keyof CallOutcomes>()
  let outputBytes = 0,
    inputBytes = 0,
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
    if (options.signal.aborted || (!output.length && !dispatched.size)) {
      rejectExecution(error)
      return
    }
    const callOutcomes: CallOutcomes = { completed: [], unconfirmed: [] }
    for (const [number, outcome] of dispatched) callOutcomes[outcome].push(number)
    rejectExecution(new CodeExecutionError(error, output, calls, callOutcomes))
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
  const guestError = (handle: QuickJSHandle) => {
    const details = JSON.stringify(context.dump(handle)) ?? 'undefined'
    return new Error(
      `Tool code failed: ${details.length > 4096 ? details.slice(0, 4096) + '…' : details}`,
    )
  }
  function pump() {
    scheduled = false
    if (closed || !script) return
    try {
      if (cpuMs >= 2000 || jobs >= 10_000) throw new Error('Tool code exceeded its CPU budget')
      // Let the guest consume each result before copying the next one into its bounded heap.
      const deliver = ready.shift()
      if (deliver) run(deliver)
      const result = run(() => runtime.executePendingJobs(100))
      if (result.error) {
        try {
          throw guestError(result.error)
        } finally {
          result.dispose()
        }
      }
      jobs += result.value
      result.dispose()
      const state = context.getPromiseState(script)
      if (state.type === 'fulfilled') {
        try {
          if (!active && !runtime.hasPendingJob()) {
            if (failure) throw failure
            const value: unknown = context.dump(state.value)
            bounded(value)
            closed = true
            resolveExecution({ result: value, output, calls })
            return
          }
        } finally {
          state.value.dispose()
        }
      } else if (state.type === 'rejected') {
        try {
          failure ??= guestError(state.error)
        } finally {
          state.error.dispose()
        }
        // Wait for started calls to settle. Do not claim that a side effect was undone.
        if (!active) throw failure
      }
      if (ready.length || runtime.hasPendingJob()) schedule()
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
      const number = ++calls
      if (number > 100 || active >= 8)
        throw new Error('Tool code supports 100 calls and 8 concurrent calls')
      const call: CodeCall = JSON.parse(context.getString(value))
      const promise = context.newPromise()
      deferred.add(promise)
      active++
      const enqueue = (settle: () => void) => {
        if (closed) return
        ready.push(() => {
          try {
            settle()
          } finally {
            active--
            deferred.delete(promise)
            promise.dispose()
          }
        })
        schedule()
      }
      void Promise.resolve()
        .then(() => {
          signal.throwIfAborted()
          dispatched.set(number, 'unconfirmed')
          return options.call(call, signal)
        })
        .then(
          (value) => {
            dispatched.set(number, 'completed')
            enqueue(() => {
              let json = JSON.stringify(value ?? null)
              let bytes = Buffer.byteLength(json)
              let recoveryId: string | undefined
              const readsResult = call.source === 'harness' && call.name === 'read_tool_result'
              if (inputBytes + bytes > MAX_BYTES && options.retainResult && !readsResult) {
                const reference = options.retainResult(value)
                if (
                  reference &&
                  typeof reference === 'object' &&
                  'resultId' in reference &&
                  typeof reference.resultId === 'string' &&
                  /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(reference.resultId)
                )
                  recoveryId = reference.resultId
                json = bounded(reference)
                bytes = Buffer.byteLength(json)
              }
              if (inputBytes + bytes > MAX_BYTES) {
                let message = 'Code mode input limit reached.'
                if (readsResult) message += ' Read the next chunk in a fresh code call.'
                else if (recoveryId)
                  message += ` The tool completed. Run tools.harness.read_tool_result({resultId:${JSON.stringify(recoveryId)}}) in a fresh code call.`
                else message += ' The tool completed. Inspect the current state before retrying.'
                context.newError(message).consume((handle) => promise.reject(handle))
                return
              }
              inputBytes += bytes
              // Parse before settling the promise. Parsing near-limit values in an async job can
              // leave QuickJS objects alive at runtime disposal.
              context.newString(json).consume((handle) => {
                context
                  .unwrapResult(context.callFunction(parseJson, context.undefined, handle))
                  .consume((value) => promise.resolve(value))
              })
            })
          },
          (error: unknown) =>
            enqueue(() => {
              context
                .newError(error instanceof Error ? error.message : String(error))
                .consume((handle) => promise.reject(handle))
            }),
        )
      return promise.handle
    })
    .consume((handle) => context.setProp(context.global, '__call', handle))
  try {
    const source = `
const invoke = async (source,name,args,server) => await __call(JSON.stringify({source,name,arguments:args,server}));
const namespace = (source,server) => new Proxy(Object.create(null), {get:(_,name)=>name==='then'?undefined:args=>invoke(source,String(name),args,server)});
const harness = namespace('harness');
const defaults = Object.fromEntries(${JSON.stringify([...codeFileAliases.keys(), 'edit', 'bash'])}.map(name => [name, harness[name]]));
globalThis.tools = Object.freeze({...defaults,dovo:namespace('dovo'),harness,mcp:new Proxy(Object.create(null),{get:(_,server)=>namespace('mcp',String(server))}),search:args=>invoke('catalog','search',args)});
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
    ready.length = 0
    options.signal.removeEventListener('abort', abort)
    controller.abort()
    for (const promise of deferred) promise.dispose()
    deferred.clear()
    script?.dispose()
    parseJson.dispose()
    context.dispose()
    runtime.dispose()
  }
}
