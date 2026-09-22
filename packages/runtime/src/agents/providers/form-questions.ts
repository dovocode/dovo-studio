import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import { z } from 'zod'
import { questionPromptSchema, type QuestionAnswers } from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import type { AgentRun } from '../types.js'
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
ajv.addFormat('password', true)
const option = z.object({ const: z.string(), title: z.string().optional() })
const choices = z.object({
  enum: z.array(z.string()).optional(),
  enumNames: z.array(z.string()).optional(),
  oneOf: z.array(option).optional(),
  anyOf: z.array(option).optional(),
})
const field = z
  .object({
    type: z.enum(['string', 'number', 'integer', 'boolean', 'array']),
    title: z.string().optional(),
    description: z.string().optional(),
    format: z.string().optional(),
    items: z.unknown().optional(),
  })
  .passthrough()
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
  const raw = z.record(z.string(), z.unknown()).parse(withoutNulls(schema))
  const form = z
    .object({ properties: z.record(z.string(), field), required: z.array(z.string()).optional() })
    .parse(raw)
  const entries = Object.entries(form.properties)
  const jsonSchema = { ...raw, type: 'object' }
  const validate = ajv.compile(jsonSchema)
  // The validator lives with this pending request; do not retain every provider schema globally.
  ajv.removeSchema(jsonSchema)
  const prompt = questionPromptSchema.parse({
    title: message,
    questions: entries.map(([name, f], index) => {
      const select = choices.parse(f.type === 'array' ? f.items : f)
      const options =
        f.type === 'boolean'
          ? [
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' },
            ]
          : ((
              select.oneOf ??
              select.anyOf ??
              select.enum?.map((value, i) => ({
                const: value,
                title: select.enumNames?.[i] ?? value,
              }))
            )?.map((value) => ({ value: value.const, label: value.title ?? value.const })) ?? [])
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
