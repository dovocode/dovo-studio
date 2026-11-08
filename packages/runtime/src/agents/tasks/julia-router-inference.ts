import { availableParallelism } from 'node:os'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { Schema } from 'effect'
import { decode, mutableStruct } from '@dovo/protocol'

export const workspaceRoutingQuestion = {
  question: 'What kind of input is this?',
  options: [
    'A website URL, web link, or host address',
    'A literal shell command or command-line program invocation',
    'A question, request, explanation, or natural-language conversation',
  ],
  type: 'choice',
}
const modes = ['browser', 'terminal', 'thread'] as const
const encodingSchema = mutableStruct({
  ids: Schema.Array(Schema.Number),
  markers: Schema.Array(Schema.Number),
  qtype: Schema.Literals([0, 1, 2]),
})
interface TokenizerModule {
  initSync(input: { module: Uint8Array }): unknown
  WasmEncoder: new (json: string) => {
    encode(request: string, maxLength: number, headLength: number, strict: boolean): string
    free(): void
  }
}
function isTokenizerModule(value: unknown): value is TokenizerModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'initSync' in value &&
    typeof value.initSync === 'function' &&
    'WasmEncoder' in value &&
    typeof value.WasmEncoder === 'function'
  )
}

/** Authors' full Julia-1 ONNX graph and strict Rust tokenizer. Files are local and pinned at build time. */
export async function loadJuliaRouter(directory: string) {
  const module: unknown = await import(
    pathToFileURL(join(directory, 'wasm/julia_webgpu_encode.js')).href
  )
  if (!isTokenizerModule(module)) throw new Error('Invalid bundled Julia tokenizer module')
  const [wasm, tokenizerJSON] = await Promise.all([
    readFile(join(directory, 'wasm/julia_webgpu_encode_bg.wasm')),
    readFile(join(directory, 'tokenizer.json'), 'utf8'),
  ])
  module.initSync({ module: new Uint8Array(wasm) })
  const tokenizer = new module.WasmEncoder(tokenizerJSON)
  let session: InferenceSession
  try {
    session = await InferenceSession.create(join(directory, 'model.onnx'), {
      executionProviders: ['cpu'],
      intraOpNumThreads: Math.min(4, availableParallelism()),
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
      logSeverityLevel: 3,
    })
  } catch (error) {
    tokenizer.free()
    throw error
  }
  return {
    async predict(state: string, question = workspaceRoutingQuestion) {
      const encoded = decode(
        encodingSchema,
        JSON.parse(tokenizer.encode(JSON.stringify({ state, ...question }), 1024, 256, true)),
      )
      const length = Math.ceil(encoded.ids.length / 8) * 8
      const count = encoded.markers.length
      if (!count || !encoded.ids.length) throw new Error('Empty Julia encoding')
      const ids = new BigInt64Array(length)
      const attention = new BigInt64Array(length)
      encoded.ids.forEach((id, i) => {
        ids[i] = BigInt(id)
        attention[i] = 1n
      })
      const output = await session.run({
        input_ids: new Tensor('int64', ids, [1, length]),
        attention_mask: new Tensor('int64', attention, [1, length]),
        marker_pos: new Tensor('int64', BigInt64Array.from(encoded.markers, BigInt), [1, count]),
        marker_mask: new Tensor('bool', new Uint8Array(count).fill(1), [1, count]),
        qtype: new Tensor('int64', BigInt64Array.of(BigInt(encoded.qtype)), [1]),
      })
      const logits = Array.from(output.logits.data, Number)
      if (logits.length !== count || logits.some((value) => !Number.isFinite(value)))
        throw new Error('Invalid Julia scores')
      const peak = Math.max(...logits)
      const index = logits.indexOf(peak)
      const weights = logits.map((value) => Math.exp(value - peak))
      const total = weights.reduce((sum, value) => sum + value, 0)
      return { index, logits, probabilities: weights.map((value) => value / total) }
    },
    async route(text: string) {
      const result = await this.predict(text)
      const mode = modes[result.index]
      if (!mode) throw new Error('Invalid Julia destination')
      return {
        mode,
        reason: `Julia-1 suggests ${mode}. Review or change the destination before continuing.`,
      }
    },
    async dispose() {
      tokenizer.free()
      await session.release()
    },
  }
}
