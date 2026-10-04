import { Agent, JsonlLocalAgentStore } from '@cursor/sdk'
import type { AgentOptions, SDKAgent, Run, ModelListItem, ModelSelection } from '@cursor/sdk'
import { z } from 'zod'

const parameter = z.object({ id: z.string().min(1), value: z.string() })
const selection = z.object({ id: z.string().min(1), params: z.array(parameter).optional() })
const strings = z.record(z.string(), z.string())
const mcp = z.union([
  z.object({
    type: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()),
    env: strings,
  }),
  z.object({ type: z.enum(['http', 'sse']), url: z.string(), headers: strings }),
])
export const cursorInputSchema = z.object({
  cwd: z.string().min(1),
  sessionId: z.string().optional(),
  model: z.string(),
  reasoning: z.string(),
  permission: z.enum(['read-only', 'auto', 'full-access']),
  tools: z.literal('none').optional(),
  prompt: z.string(),
  images: z.array(z.object({ data: z.string(), mimeType: z.string() })),
  mcpServers: z.record(z.string(), mcp),
  storeDirectory: z.string().optional(),
})
export type CursorInput = z.infer<typeof cursorInputSchema>
export const cursorEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('boundary') }),
  z.object({ type: z.literal('session'), id: z.string().min(1) }),
  z.object({ type: z.literal('accepted'), steer: z.boolean() }),
  z.object({ type: z.literal('event'), name: z.string(), payload: z.unknown() }),
])
export type CursorEvent = z.infer<typeof cursorEventSchema>

export function cursorSelection(model: string, reasoning: string): ModelSelection {
  if (!model.trim()) throw new Error('Choose a Cursor model before starting a thread')
  const chosen = model.startsWith('{') ? selection.parse(JSON.parse(model)) : { id: model }
  const params = [...(chosen.params ?? [])]
  if (reasoning) {
    const effort = parameter.parse(JSON.parse(reasoning))
    const index = params.findIndex((value) => value.id === effort.id)
    if (index >= 0) params.splice(index, 1)
    params.push(effort)
  }
  return { id: chosen.id, ...(params.length ? { params } : {}) }
}

export function cursorModels(rows: ModelListItem[]) {
  const models = rows.flatMap((row) => {
    const effort = row.parameters?.find((value) =>
      /^(reasoning_effort|reasoning|effort)$/.test(value.id),
    )
    const reasoning = effort
      ? effort.values.map((value) => ({
          id: JSON.stringify({ id: effort.id, value: value.value }),
          name: value.displayName || value.value,
        }))
      : []
    const base = { description: row.description, reasoning }
    if (row.variants?.length)
      return row.variants.map((variant) => ({
        ...base,
        id: JSON.stringify({ id: row.id, params: variant.params }),
        name: `${row.displayName} · ${variant.displayName}`,
        description: variant.description || row.description,
        isDefault: variant.isDefault,
        defaultReasoning:
          effort && variant.params.find((value) => value.id === effort.id)
            ? JSON.stringify(variant.params.find((value) => value.id === effort.id))
            : undefined,
      }))
    return [{ ...base, id: row.id, name: row.displayName }]
  })
  return {
    models,
    reasoning: [
      ...new Map(
        models.flatMap((model) => model.reasoning).map((value) => [value.id, value]),
      ).values(),
    ],
  }
}

export function cursorOptions(input: CursorInput): AgentOptions {
  const restricted = input.tools === 'none' || input.permission === 'read-only'
  return {
    model: cursorSelection(input.model, input.reasoning),
    ...(restricted ? { tools: input.tools === 'none' ? [] : ['read', 'grep', 'glob', 'ls'] } : {}),
    // SDK questions have no public response API. Thread MCP questions remain available.
    disallowedTools: restricted ? ['mcp', 'task', 'askQuestion'] : ['askQuestion'],
    mcpServers: restricted ? {} : input.mcpServers,
    local: {
      cwd: input.cwd,
      autoReview: !restricted && input.permission === 'auto',
      settingSources: restricted ? [] : ['all'],
      enableAgentRetries: false,
      // Child sessions inherit exclusions, including the unsupported SDK question tool.
      subagentInherit: {},
      ...(input.storeDirectory ? { store: new JsonlLocalAgentStore(input.storeDirectory) } : {}),
    },
  }
}

type CursorAgent = Pick<SDKAgent, 'agentId' | 'send' | typeof Symbol.asyncDispose>
type CursorFactory = {
  create(options: AgentOptions): Promise<CursorAgent>
  resume(id: string, options: AgentOptions): Promise<CursorAgent>
}

/** One isolated worker owns one SDK run. No process-global credential changes in the runtime. */
export function cursorSession(emit: (event: CursorEvent) => void, factory: CursorFactory = Agent) {
  let active: Run | undefined,
    cancelled = false,
    steering = false
  return {
    async cancel() {
      cancelled = true
      await active?.cancel()
    },
    async steer(text: string) {
      if (!active?.steer || cancelled || steering)
        throw new Error('Cursor cannot accept this steering input')
      steering = true
      // Only complete_delivered transfers ownership; the outbox retries a follow-up otherwise.
      if ((await active.steer(text)) !== 'complete_delivered')
        throw new Error('Cursor did not accept steering; send this as a follow-up')
    },
    async run(input: CursorInput) {
      if (input.sessionId?.startsWith('bc-'))
        throw new Error('Cursor cloud sessions cannot run on a local Dovo runtime')
      const options = cursorOptions(input)
      const agent = input.sessionId
        ? await factory.resume(input.sessionId, options)
        : await factory.create(options)
      let boundary = false,
        emitted = false,
        usageIndex = 0,
        thinkingIndex = 0
      try {
        if (cancelled) throw new Error('Cursor run cancelled')
        emit({ type: 'session', id: agent.agentId })
        active = await agent.send(
          { text: input.prompt, images: input.images },
          {
            model: options.model,
            mcpServers: options.mcpServers,
            onStep: ({ step }) => {
              if (step.type === 'assistantMessage') boundary = true
            },
            onDelta: ({ update }) => {
              if (update.type === 'text-delta' && update.text) {
                if (boundary && emitted) emit({ type: 'boundary' })
                boundary = false
                emitted = true
                emit({ type: 'text', text: update.text })
              } else if (update.type === 'thinking-delta')
                emit({
                  type: 'event',
                  name: 'cursor/thinking',
                  payload: { id: thinkingIndex, text: update.text },
                })
              else if (update.type === 'thinking-completed') {
                emit({
                  type: 'event',
                  name: 'cursor/thinking-completed',
                  payload: { id: thinkingIndex++ },
                })
              } else if (update.type === 'summary-completed')
                emit({ type: 'event', name: 'cursor/summary-completed', payload: {} })
            },
          },
        )
        if (cancelled) {
          await active.cancel()
          throw new Error('Cursor run cancelled')
        }
        emit({ type: 'accepted', steer: typeof active.steer === 'function' })
        const stream = async () => {
          for await (const message of active!.stream()) {
            if (message.type === 'tool_call' || message.type === 'usage')
              emit({
                type: 'event',
                name: `cursor/${message.type}`,
                payload: {
                  ...message,
                  ...(message.type === 'usage'
                    ? { usageId: `${message.run_id}:${usageIndex++}` }
                    : {}),
                },
              })
          }
        }
        const [result] = await Promise.all([active.wait(), stream()])
        if (result.status !== 'finished')
          throw new Error(result.error?.message || `Cursor run ${result.status}`)
        if (!emitted && result.result) emit({ type: 'text', text: result.result })
      } finally {
        try {
          await active?.cancel()
        } finally {
          active = undefined
          await agent[Symbol.asyncDispose]()
        }
      }
    },
  }
}
