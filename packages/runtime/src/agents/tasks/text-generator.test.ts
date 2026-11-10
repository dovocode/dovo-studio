import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { generateUtilityText } from './text-generator'
import type { SecretReferences } from '../configuration/secret-references'
import type { TextGenerator } from '@dovo/protocol'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.restoreAllMocks()
})
async function server(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
) {
  const listener = createServer(handler)
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('No test listener')
  return `http://127.0.0.1:${address.port}/v1`
}
const input = () => ({
  model: 'small-local-model',
  instructions: 'Write text only.',
  prompt: 'Describe the changes.',
  limit: 4000,
  signal: AbortSignal.timeout(5000),
})
it.each(['openai', 'anthropic'] as const)(
  'uses the real %s HTTP contract and resolves keys only on the host',
  async (kind) => {
    const requests: { path?: string; headers: IncomingMessage['headers']; body: string }[] = []
    const baseUrl = await server(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push({ path: request.url, headers: request.headers, body })
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify(
          kind === 'openai'
            ? { choices: [{ message: { content: 'Useful text' } }] }
            : {
                content: [
                  { type: 'thinking', thinking: 'private' },
                  { type: 'text', text: 'Useful text' },
                ],
              },
        ),
      )
    })
    const value = vi.fn<SecretReferences['value']>(async () => 'fixture-key')
    const generator: TextGenerator = {
      kind,
      baseUrl,
      model: 'small-local-model',
      apiKey: { provider: 'environment', reference: 'FIXTURE_KEY' },
    }
    expect(await generateUtilityText(generator, { value }, input())).toBe('Useful text')
    expect(value).toHaveBeenCalledWith(generator.apiKey, expect.any(AbortSignal))
    const request = requests[0]
    expect(request.path).toBe(`/v1/${kind === 'openai' ? 'chat/completions' : 'messages'}`)
    expect(request.headers[kind === 'openai' ? 'authorization' : 'x-api-key']).toBe(
      kind === 'openai' ? 'Bearer fixture-key' : 'fixture-key',
    )
    const body = JSON.parse(request.body)
    expect(body).toMatchObject({ model: 'small-local-model', messages: expect.any(Array) })
    expect(body.tools).toBeUndefined()
    expect(request.body).not.toContain('fixture-key')
    expect(request.body).not.toContain('FIXTURE_KEY')
  },
)
it('supports an unauthenticated local API and never follows credential redirects', async () => {
  let forwarded = 0
  const target = await server((_, response) => {
    forwarded++
    response.end('{}')
  })
  const baseUrl = await server((request, response) => {
    expect(request.headers.authorization).toBeUndefined()
    response.writeHead(307, { location: `${target}/chat/completions` })
    response.end()
  })
  await expect(
    generateUtilityText(
      { kind: 'openai', baseUrl, model: 'local' },
      { value: vi.fn<SecretReferences['value']>() },
      input(),
    ),
  ).rejects.toThrow('fetch failed')
  expect(forwarded).toBe(0)
})
it.each([
  [401, '{"error":"fixture-secret in upstream failure"}', /rejected its credential/],
  [503, 'fixture-secret in upstream failure', /HTTP 503/],
  [200, 'not JSON', /invalid JSON/],
  [200, '{}', /unsupported response/],
  [200, JSON.stringify({ choices: [{ message: { content: '' } }] }), /empty or oversized/],
  [200, 'x'.repeat(512 * 1024 + 1), /too much data/],
] as const)('bounds and sanitizes API failure %s', async (status, body, message) => {
  const baseUrl = await server((_, response) => {
    response.writeHead(status)
    response.end(body)
  })
  const result = generateUtilityText(
    { kind: 'openai', baseUrl, model: 'local' },
    { value: vi.fn<SecretReferences['value']>() },
    input(),
  )
  await expect(result).rejects.toThrow(message)
  await expect(result).rejects.not.toThrow('fixture-secret')
})
it('aborts an in-flight API request', async () => {
  let admitted: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    admitted = resolve
  })
  const baseUrl = await server(() => admitted())
  const controller = new AbortController()
  const result = generateUtilityText(
    { kind: 'openai', baseUrl, model: 'local' },
    { value: vi.fn<SecretReferences['value']>() },
    { ...input(), signal: controller.signal },
  )
  const failure = result.catch((cause: unknown) => cause)
  await ready
  controller.abort()
  expect(await failure).toMatchObject({ name: 'AbortError' })
})
