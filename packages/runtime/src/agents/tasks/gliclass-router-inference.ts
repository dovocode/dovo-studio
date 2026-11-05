import { availableParallelism } from 'node:os'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  workspaceRouteSchema,
  type WorkspaceRouteRequest,
  type WorkspaceChoice,
} from '@dovo/protocol'

const instruction = mutableStruct({ instruction: Schema.String })
const configSchema = mutableStruct({
  labels: Schema.Array(Schema.Literals(['browser', 'terminal', 'thread'])),
  labelDescriptions: Schema.Array(Schema.String),
  maxLength: Schema.Literal(384),
  maxOptions: Schema.Literal(16),
  tasks: mutableStruct({
    destination: instruction,
    runtime: instruction,
    model: instruction,
    project: instruction,
    profile: instruction,
  }),
})
interface Tokenizer {
  encode(text: string): { ids: number[] }
}
interface TokenizerModule {
  Tokenizer: new (json: unknown, config: unknown) => Tokenizer
}
function isTokenizerModule(value: unknown): value is TokenizerModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'Tokenizer' in value &&
    typeof value.Tokenizer === 'function'
  )
}

/** The pinned, post-trained run-09 export. All inference and tokenization stay local. */
export async function loadGliclassRouter(directory: string) {
  const [module, config, json, tokenizerConfig]: [unknown, unknown, unknown, unknown] =
    await Promise.all([
      import(pathToFileURL(join(directory, 'tokenizer.mjs')).href),
      readFile(join(directory, 'routing.json'), 'utf8').then(JSON.parse),
      readFile(join(directory, 'tokenizer.json'), 'utf8').then(JSON.parse),
      readFile(join(directory, 'tokenizer_config.json'), 'utf8').then(JSON.parse),
    ])
  if (!isTokenizerModule(module)) throw new Error('Invalid bundled GLiClass tokenizer')
  const settings = decode(configSchema, config)
  const tokenizer = new module.Tokenizer(json, tokenizerConfig)
  const session = await InferenceSession.create(join(directory, 'model.onnx'), {
    executionProviders: ['cpu'],
    intraOpNumThreads: Math.min(4, availableParallelism()),
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  })
  type Field = keyof typeof settings.tasks
  const encode = (task: Field, text: string, choices: readonly WorkspaceChoice[]) => {
    if (
      [text, ...choices.map((choice) => choice.label)].some((value) =>
        /<<LABEL>>|<<SEP>>/.test(value),
      )
    )
      throw new RangeError('Input contains reserved classifier markers')
    return tokenizer.encode(
      choices.map((choice) => `<<LABEL>>${choice.label}`).join('') +
        '<<SEP>>' +
        settings.tasks[task].instruction +
        text,
    ).ids
  }
  const predict = async (task: Field, text: string, choices: readonly WorkspaceChoice[]) => {
    const ids = encode(task, text, choices)
    if (!choices.length || choices.length > settings.maxOptions || ids.length > settings.maxLength)
      throw new RangeError('Input or choices exceed the local classifier token limit')
    if (choices.length === 1) return { id: choices[0]!.id, logits: [] }
    const output = await session.run({
      input_ids: new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      attention_mask: new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]),
    })
    const raw = output.logits?.data
    if (!raw || raw.length !== settings.maxOptions) throw new Error('Invalid GLiClass output')
    const logits = Array.from(raw, Number).slice(0, choices.length)
    if (!logits.every(Number.isFinite)) throw new Error('Invalid GLiClass scores')
    return { id: choices[logits.indexOf(Math.max(...logits))]!.id, logits }
  }
  // Large catalogs use model-selected finalists, never text matching or silent truncation.
  const choose = async (
    task: Field,
    text: string,
    supplied: readonly WorkspaceChoice[],
  ): Promise<string> => {
    if (!supplied.length || new Set(supplied.map((choice) => choice.id)).size !== supplied.length)
      throw new Error('Invalid classifier choices')
    let choices = [...supplied]
    while (choices.length > 1) {
      const groups: WorkspaceChoice[][] = []
      for (const choice of choices) {
        const group = groups.at(-1)
        if (
          group &&
          group.length < settings.maxOptions &&
          encode(task, text, [...group, choice]).length <= settings.maxLength
        )
          group.push(choice)
        else {
          if (encode(task, text, [choice]).length > settings.maxLength)
            throw new RangeError('Input exceeds the local classifier token limit')
          groups.push([choice])
        }
      }
      if (groups.length === choices.length)
        throw new RangeError('Input leaves no room to compare classifier choices')
      const finalists: WorkspaceChoice[] = []
      for (const group of groups) {
        const result = await predict(task, text, group)
        finalists.push(group.find((choice) => choice.id === result.id)!)
      }
      choices = finalists
    }
    // Also validate the token budget for a singleton catalog.
    return (await predict(task, text, choices)).id
  }
  return {
    predict,
    async route(request: WorkspaceRouteRequest) {
      const mode =
        request.mode ??
        (await choose(
          'destination',
          request.text,
          settings.labels.map((id, i) => ({ id, label: settings.labelDescriptions[i]! })),
        ))
      const fields =
        mode === 'browser'
          ? (['runtime', 'profile'] as const)
          : mode === 'terminal'
            ? (['runtime', 'project'] as const)
            : (['runtime', 'project', 'model'] as const)
      const selections: Partial<Record<'runtime' | 'project' | 'model' | 'profile', string>> = {}
      for (const field of fields) {
        const choices = request.catalogs?.[field]
        if (choices?.length) selections[field] = await choose(field, request.text, choices)
      }
      return decode(workspaceRouteSchema, {
        mode,
        reason: `GLiClass suggests ${mode}. Review the destination and selections before continuing.`,
        ...(Object.keys(selections).length ? { selections } : {}),
      })
    },
    async dispose() {
      await session.release()
    },
  }
}
