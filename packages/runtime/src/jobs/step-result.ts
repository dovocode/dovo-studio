import { Ajv, type ValidateFunction } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { Schema } from 'effect'
import { decode, type Task, type TaskTurn } from '@dovo/protocol'

const draft7 = new Ajv({ addUsedSchema: false })
const draft2020 = new Ajv2020({ addUsedSchema: false })
addFormats(draft7)
addFormats(draft2020)
const validators = new Map<string, ValidateFunction>()

export function compileStepResult(schemaText: string) {
  const cached = validators.get(schemaText)
  if (cached) return cached
  const schema = decode(Schema.Record(Schema.String, Schema.Json), JSON.parse(schemaText))
  if (schema.$async === true) throw new Error('Asynchronous result schemas are unsupported.')
  const ajv =
    typeof schema.$schema === 'string' && /\/draft-07\/schema#?$/.test(schema.$schema)
      ? draft7
      : draft2020
  try {
    const validate = ajv.compile(schema)
    validators.set(schemaText, validate)
    const oldest = validators.keys().next().value
    if (validators.size > 32 && oldest !== undefined) validators.delete(oldest)
    return validate
  } finally {
    ajv.removeSchema(schema)
  }
}

export function stepResultInstructions(schema: string | undefined) {
  return schema === undefined
    ? []
    : [
        `Return the step result as a single JSON value matching this JSON Schema. Write only the JSON in your final reply, without Markdown fences. You may attach files separately.\n${schema}`,
      ]
}

export function readStepResult(schema: string, task: Task, turn: TaskTurn) {
  if (turn.status !== 'completed') throw new Error('The automation worker turn did not complete.')
  const text = task.messages.find(
    (message) => message.id === turn.assistantId && message.role === 'assistant',
  )?.text
  if (!text?.trim()) throw new Error('The automation worker did not return a JSON result.')
  if (Buffer.byteLength(text) > 32768) throw new Error('The automation result exceeds 32 KiB.')
  let value: Schema.Json
  try {
    value = decode(Schema.Json, JSON.parse(text))
  } catch {
    throw new Error('The automation result is not valid JSON.')
  }
  validateStepResult(schema, value)
  return value
}

export function validateStepResult(schema: string, value: Schema.Json) {
  const validate = compileStepResult(schema)
  if (!validate(value)) {
    const error = validate.errors?.[0]
    throw new Error(
      `The automation result does not match its schema.${error ? ` ${error.instancePath || '/'} ${error.message}` : ''}`,
    )
  }
}
