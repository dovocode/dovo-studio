import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import { Schema } from 'effect'
import { questionPromptSchema, type QuestionAnswers } from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import type { AgentRun } from '../types.js'
const ajv = new Ajv({
  allErrors: true,
  strict: false,
})
addFormats(ajv)
ajv.addFormat('password', true)
const option = mutableStruct({
  const: Schema.String,
  title: Schema.optional(Schema.String),
})
const choices = mutableStruct({
  enum: Schema.optional(mutableArray(Schema.String)),
  enumNames: Schema.optional(mutableArray(Schema.String)),
  oneOf: Schema.optional(mutableArray(option)),
  anyOf: Schema.optional(mutableArray(option)),
})
const field = Schema.Struct(
  mutableStruct({
    type: Schema.Literal('string', 'number', 'integer', 'boolean', 'array'),
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    format: Schema.optional(Schema.String),
    items: Schema.optional(Schema.Unknown),
  }).fields,
  {
    key: Schema.String,
    value: Schema.Unknown,
  },
)
// ACP permits null for omitted annotations; JSON Schema expects those keys to be absent.
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, v]) => v !== null && key !== '_meta')
        .map(([key, v]) => [key, withoutNulls(v)]),
    )
  return value
}
export async function formQuestions(
  message: string,
  schema: unknown,
  run: AgentRun,
  signal?: AbortSignal,
) {
  const raw = decode(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.Unknown,
      }),
    ),
    withoutNulls(schema),
  )
  const form = decode(
    mutableStruct({
      properties: Schema.mutable(
        Schema.Record({
          key: Schema.String,
          value: field,
        }),
      ),
      required: Schema.optional(mutableArray(Schema.String)),
    }),
    raw,
  )
  const entries = Object.entries(form.properties)
  const jsonSchema = {
    ...raw,
    type: 'object',
  }
  const validate = ajv.compile(jsonSchema)
  // The validator lives with this pending request; do not retain every provider schema globally.
  ajv.removeSchema(jsonSchema)
  const prompt = decode(questionPromptSchema, {
    title: message,
    questions: entries.map(([name, f], index) => {
      const select = decode(choices, f.type === 'array' ? f.items : f)
      const options =
        f.type === 'boolean'
          ? [
              {
                value: 'true',
                label: 'Yes',
              },
              {
                value: 'false',
                label: 'No',
              },
            ]
          : ((
              select.oneOf ??
              select.anyOf ??
              select.enum?.map((value, i) => ({
                const: value,
                title: select.enumNames?.[i] ?? value,
              }))
            )?.map((value) => ({
              value: value.const,
              label: value.title ?? value.const,
            })) ?? [])
      if (f.type === 'array' && !options.length)
        throw new Error('Form arrays must provide selectable options')
      return {
        id: String(index),
        header: f.title ?? name,
        question: f.description ?? f.title ?? name,
        options,
        required: form.required?.includes(name) ?? false,
        multiple: f.type === 'array',
        custom: !options.length,
        inputType: ['number', 'integer'].includes(f.type) ? 'number' : 'text',
        secret: f.format === 'password',
      }
    }),
  })
  const content = (
    answers: QuestionAnswers,
  ): Record<string, string | number | boolean | string[]> =>
    Object.fromEntries(
      entries.flatMap(([name, f], index) => {
        const values = answers[String(index)] ?? []
        if (!values.length) return []
        const value =
          f.type === 'array'
            ? values
            : f.type === 'boolean'
              ? values[0] === 'true'
              : ['integer', 'number'].includes(f.type)
                ? Number(values[0])
                : values[0]
        return [[name, value]]
      }),
    )
  const answers = await run.ask(prompt, signal, (answers) => {
    if (!validate(content(answers))) throw new HttpError(400, ajv.errorsText(validate.errors))
  })
  return answers ? content(answers) : null
}
