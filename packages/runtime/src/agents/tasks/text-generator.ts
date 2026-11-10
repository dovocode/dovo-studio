import { Schema } from 'effect'
import { decode, mutableArray, mutableStruct, type TextGenerator } from '@dovo/protocol'
import type { SecretReferences } from '../configuration/secret-references.js'
import { HttpError } from '../../errors.js'

const chatSchema = mutableStruct({
  choices: mutableArray(
    mutableStruct({
      message: mutableStruct({ content: Schema.NullOr(Schema.String) }),
    }),
  ),
})
const anthropicSchema = mutableStruct({
  content: mutableArray(
    mutableStruct({ type: Schema.String, text: Schema.optional(Schema.String) }),
  ),
})

/** Only text enters this boundary. No tools, checkout, native session or client credentials. */
export async function generateUtilityText(
  generator: TextGenerator,
  secrets: Pick<SecretReferences, 'value'>,
  input: {
    model: string
    instructions: string
    prompt: string
    limit: number
    signal: AbortSignal
  },
) {
  input.signal.throwIfAborted()
  const key = generator.apiKey ? await secrets.value(generator.apiKey, input.signal) : undefined
  const anthropic = generator.kind === 'anthropic'
  const response = await fetch(
    `${generator.baseUrl.replace(/\/+$/, '')}/${anthropic ? 'messages' : 'chat/completions'}`,
    {
      method: 'POST',
      signal: input.signal,
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(anthropic
          ? { 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) }
          : key
            ? { Authorization: `Bearer ${key}` }
            : {}),
      },
      body: JSON.stringify(
        anthropic
          ? {
              model: input.model,
              max_tokens: Math.min(8192, input.limit),
              system: input.instructions,
              messages: [{ role: 'user', content: input.prompt }],
            }
          : {
              model: input.model,
              max_completion_tokens: Math.min(8192, input.limit),
              messages: [
                { role: 'system', content: input.instructions },
                { role: 'user', content: input.prompt },
              ],
            },
      ),
    },
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new HttpError(
      502,
      response.status === 401 || response.status === 403
        ? 'The text generator rejected its credential. Check its key reference on this computer.'
        : `The text generator failed (HTTP ${response.status}). Try again or choose another utility target.`,
    )
  }
  if (!response.body) throw new HttpError(502, 'The text generator returned no response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let encoded = '',
    bytes = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 512 * 1024) throw new HttpError(502, 'The text generator returned too much data')
      encoded += decoder.decode(chunk.value, { stream: true })
    }
    encoded += decoder.decode()
  } finally {
    await reader.cancel()
  }
  let value: unknown
  try {
    value = JSON.parse(encoded)
  } catch {
    throw new HttpError(502, 'The text generator returned invalid JSON')
  }
  let text: string
  try {
    text = anthropic
      ? decode(anthropicSchema, value)
          .content.filter((item) => item.type === 'text')
          .map((item) => item.text ?? '')
          .join('')
      : (decode(chatSchema, value).choices[0]?.message.content ?? '')
  } catch {
    throw new HttpError(502, 'The text generator returned an unsupported response')
  }
  if (!text.trim() || text.length > input.limit)
    throw new HttpError(502, 'The text generator returned empty or oversized text')
  return text.trim()
}
