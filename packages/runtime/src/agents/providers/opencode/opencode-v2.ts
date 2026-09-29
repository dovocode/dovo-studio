import { createHash } from 'node:crypto'
import { OpenCode } from '@opencode/client'
import { decode, isImageAttachment, questionPromptSchema } from '@dovo/protocol'
import { mcpHeaders, mcpServerEnvironment } from '../../configuration/mcp-settings.js'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'

const addressOf = (address: string) => (address || 'http://127.0.0.1:4096').replace(/\/$/, '')
const headers = (): Record<string, string> =>
  process.env.OPENCODE_SERVER_PASSWORD
    ? {
        Authorization: `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`,
      }
    : {}
const client = (address: string) =>
  OpenCode.make({ baseUrl: addressOf(address), headers: headers() })

/** A V1 server has no /api/info route. Authentication errors must not silently select V1. */
export async function isOpencodeV2(address: string): Promise<boolean> {
  const response = await fetch(`${addressOf(address)}/api/info`, {
    headers: headers(),
    signal: AbortSignal.timeout(5000),
  })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`OpenCode server info failed (${response.status})`)
  const info: unknown = await response.json()
  return (
    typeof info === 'object' &&
    info !== null &&
    'version' in info &&
    typeof info.version === 'string' &&
    /^2\./.test(info.version)
  )
}

function modelOf(run: AgentRun) {
  const slash = run.agent.model.indexOf('/')
  if (slash < 1 || slash === run.agent.model.length - 1)
    throw new Error('Choose an OpenCode provider/model')
  return {
    providerID: run.agent.model.slice(0, slash),
    id: run.agent.model.slice(slash + 1),
    ...(run.agent.reasoning ? { variant: run.agent.reasoning } : {}),
  }
}

export const opencodeV2Adapter: AgentAdapter = {
  models: async (agent) => {
    const { data } = await client(agent.endpoint).model.list()
    return {
      models: data
        .filter((model) => model.enabled)
        .map((model) => ({
          id: `${model.providerID}/${model.modelID}`,
          name: model.name,
          reasoning: model.variants.map(({ id }) => ({ id, name: id })),
        })),
      reasoning: [],
    }
  },
  probe: async (agent) => {
    try {
      await client(agent.endpoint).server.info({ signal: AbortSignal.timeout(5000) })
      return { provider: 'opencode', available: true, detail: 'OpenCode 2 Serve is reachable.' }
    } catch {
      return {
        provider: 'opencode',
        available: false,
        detail: 'Start opencode serve on the runtime host or set its URL.',
      }
    }
  },
  async run(run) {
    run.signal.throwIfAborted()
    const api = client(run.agent.endpoint)
    const registered: string[] = []
    const location = { directory: run.cwd }
    try {
      const namespace = `dovo_${createHash('sha256')
        .update(JSON.stringify([run.cwd, run.agent.id, run.agent.resources]))
        .digest('hex')
        .slice(0, 12)}`
      for (const server of run.tools === 'none' ? [] : (run.agent.resources?.mcpServers ?? [])) {
        if (!server.enabled) continue
        const name = `${namespace}_${server.name}`
        registered.push(name)
        await api.mcp.add(
          {
            server: name,
            location,
            config:
              server.transport === 'stdio'
                ? {
                    type: 'local',
                    command: [server.command, ...server.args],
                    environment: mcpServerEnvironment(server),
                  }
                : { type: 'remote', url: server.url, headers: mcpHeaders(server), oauth: false },
          },
          { signal: run.signal },
        )
        const status = (await api.mcp.list({ location })).data.find((item) => item.name === name)
        if (status?.status.status !== 'connected')
          throw new Error(
            `MCP server ${server.name} could not connect (${status?.status.status ?? 'unknown status'}). Test its configuration in Settings.`,
          )
      }
      const permissions: Array<{
        action: string
        resource: string
        effect: 'allow' | 'deny' | 'ask'
      }> = [
        {
          action: '*',
          resource: '*',
          effect:
            run.tools === 'none' || run.agent.permission === 'read-only'
              ? 'deny'
              : run.agent.permission === 'full-access'
                ? 'allow'
                : 'ask',
        },
      ]
      if (run.tools !== 'none') {
        for (const action of ['read', 'glob', 'grep', 'list', 'question'])
          permissions.push({ action, resource: '*', effect: 'allow' })
        if (run.agent.permission === 'workspace-write')
          permissions.push({ action: 'edit', resource: '*', effect: 'allow' })
      }
      permissions.push({ action: 'dovo_*', resource: '*', effect: 'deny' })
      for (const name of registered)
        permissions.push({
          action: `${name}_*`,
          resource: '*',
          effect:
            run.agent.permission === 'read-only'
              ? 'deny'
              : run.agent.permission === 'full-access'
                ? 'allow'
                : 'ask',
        })
      const sessionID =
        run.sessionId ??
        (
          await api.session.create(
            {
              title: 'Dovo Studio task',
              ...(run.agent.model ? { model: modelOf(run) } : {}),
              location,
              permissions,
            },
            { signal: run.signal },
          )
        ).id
      if (run.sessionId) {
        await api.session.update({ sessionID, permissions }, { signal: run.signal })
        if (run.agent.model)
          await api.session.switchModel({ sessionID, model: modelOf(run) }, { signal: run.signal })
      }
      run.onSession(sessionID)
      if (run.agent.instructions)
        await api.session.instructions.entry.put(
          { sessionID, key: 'dovo-agent', value: run.agent.instructions },
          { signal: run.signal },
        )
      const streamController = new AbortController()
      const abort = () => {
        streamController.abort()
        void api.session
          .interrupt({ sessionID }, { signal: AbortSignal.timeout(5000) })
          .catch((error) => run.onActivity(`Could not interrupt OpenCode: ${String(error)}`))
      }
      run.signal.addEventListener('abort', abort, { once: true })
      if (run.signal.aborted) abort()
      const names = new Map<string, string>()
      const inputs = new Map<string, Record<string, unknown>>()
      const reasoning = new Map<string, string>()
      let resolveDone!: () => void
      let rejectDone!: (reason: Error) => void
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve
        rejectDone = reject
      })
      let resolveConnected!: () => void
      const connected = new Promise<void>((resolve) => {
        resolveConnected = resolve
      })
      void done.catch(() => undefined)
      const cancelDone = () => rejectDone(new Error('Task cancelled'))
      run.signal.addEventListener('abort', cancelDone, { once: true })
      if (run.signal.aborted) cancelDone()
      let accepted = false
      const emitTool = (id: string, status: 'running' | 'completed' | 'error', output?: string) => {
        run.onEvent?.('message.part.updated', {
          properties: {
            sessionID,
            part: {
              id,
              sessionID,
              type: 'tool',
              callID: id,
              tool: names.get(id) ?? 'tool',
              state: {
                status,
                input: inputs.get(id) ?? {},
                ...(output === undefined ? {} : { output }),
              },
            },
          },
        })
      }
      const consume = (async () => {
        for await (const event of api.event.subscribe({ signal: streamController.signal })) {
          if (event.type === 'server.connected') {
            resolveConnected()
            continue
          }
          const data = 'data' in event ? event.data : undefined
          const scope = data && typeof data === 'object' ? data : undefined
          const eventSession =
            scope && 'sessionID' in scope
              ? scope.sessionID
              : event.type === 'form.created'
                ? event.data.form.sessionID
                : undefined
          if (eventSession !== sessionID) continue
          if (
            !accepted &&
            (event.type === 'session.text.delta' ||
              event.type === 'session.reasoning.delta' ||
              event.type === 'session.tool.input.started' ||
              event.type === 'session.execution.started' ||
              event.type === 'permission.asked' ||
              event.type === 'form.created')
          ) {
            accepted = true
            run.onPromptAccepted?.()
          }
          run.onEvent?.(event.type, event)
          switch (event.type) {
            case 'session.text.delta':
              run.onText(event.data.delta)
              break
            case 'session.reasoning.delta': {
              const id = `${event.data.assistantMessageID}:${event.data.ordinal}`
              const value = (reasoning.get(id) ?? '') + event.data.delta
              reasoning.set(id, value)
              run.onEvent?.('message.part.updated', {
                properties: { sessionID, part: { id, type: 'reasoning', text: value } },
              })
              break
            }
            case 'session.reasoning.ended': {
              const id = `${event.data.assistantMessageID}:${event.data.ordinal}`
              reasoning.delete(id)
              run.onEvent?.('message.part.updated', {
                properties: {
                  sessionID,
                  part: {
                    id,
                    type: 'reasoning',
                    text: event.data.text,
                    time: { end: event.created },
                  },
                },
              })
              break
            }
            case 'session.tool.input.started':
              names.set(event.data.id, event.data.name)
              emitTool(event.data.id, 'running')
              break
            case 'session.tool.called':
              inputs.set(event.data.id, event.data.input)
              emitTool(event.data.id, 'running')
              break
            case 'session.tool.success':
              emitTool(
                event.data.id,
                'completed',
                event.data.content
                  .map((part) => (part.type === 'text' ? part.text : ''))
                  .join('\n'),
              )
              break
            case 'session.tool.failed':
              emitTool(event.data.id, 'error', event.data.error.message)
              break
            case 'session.execution.succeeded':
              if (!run.compact) resolveDone()
              break
            case 'session.execution.failed':
              if (!run.compact) rejectDone(new Error(event.data.error.message))
              break
            case 'session.execution.interrupted':
              rejectDone(new Error('OpenCode task interrupted'))
              break
            case 'session.compaction.ended':
              if (run.compact && event.data.reason === 'manual') resolveDone()
              break
            case 'session.compaction.failed':
              if (run.compact) rejectDone(new Error(event.data.error.message))
              break
            case 'permission.asked': {
              const allow =
                run.agent.permission !== 'read-only' &&
                (await run.approve(
                  event.data.message || event.data.action,
                  event.data.resources.join('\n'),
                ))
              if (!streamController.signal.aborted)
                await api.permission.reply(
                  { sessionID, requestID: event.data.id, decision: allow ? 'once' : 'reject' },
                  { signal: run.signal },
                )
              break
            }
            case 'form.created': {
              const form = event.data.form
              const answers = await run.ask(
                decode(questionPromptSchema, {
                  title: form.title,
                  questions: form.fields.map((field) => ({
                    id: field.key,
                    header: field.title || field.key,
                    question: field.description || field.title || field.key,
                    options: 'options' in field ? field.options : [],
                    multiple: field.type === 'multiselect',
                    inputType:
                      field.type === 'number' || field.type === 'integer' ? 'number' : 'text',
                    secret: 'hidden' in field && field.hidden === true,
                    required: !('required' in field) || field.required !== false,
                  })),
                }),
                streamController.signal,
              )
              if (streamController.signal.aborted) break
              if (answers)
                await api.session.form.reply(
                  {
                    sessionID,
                    formID: form.id,
                    answer: Object.fromEntries(
                      form.fields.flatMap((field) => {
                        const values = answers[field.key]
                        if (!values) return []
                        const value =
                          field.type === 'multiselect'
                            ? values
                            : field.type === 'boolean'
                              ? values[0] === 'true'
                              : field.type === 'number' || field.type === 'integer'
                                ? Number(values[0])
                                : (values[0] ?? '')
                        return [[field.key, value]]
                      }),
                    ),
                  },
                  { signal: run.signal },
                )
              else
                await api.session.form.cancel(
                  { sessionID, formID: form.id },
                  { signal: run.signal },
                )
              break
            }
          }
        }
        if (!streamController.signal.aborted)
          rejectDone(new Error('OpenCode event stream closed before the turn completed'))
      })()
      try {
        await Promise.race([connected, done])
        const task = run.compact
          ? api.session.compact({ sessionID }, { signal: run.signal })
          : api.session.prompt(
              {
                sessionID,
                text: run.prompt,
                files: (run.attachments ?? []).filter(isImageAttachment).map((file) => ({
                  uri: `data:${file.mime};base64,${file.data}`,
                  name: file.name,
                })),
              },
              { signal: run.signal },
            )
        await Promise.race([task, done])
        run.onPromptAccepted?.()
        await done
      } finally {
        streamController.abort()
        run.signal.removeEventListener('abort', abort)
        run.signal.removeEventListener('abort', cancelDone)
        await consume.catch((error) => {
          if (!streamController.signal.aborted) throw error
        })
      }
    } finally {
      const results = await Promise.allSettled(
        registered.map((server) =>
          api.mcp.remove({ server, location }, { signal: AbortSignal.timeout(5000) }),
        ),
      )
      results.forEach((result, index) => {
        if (result.status === 'rejected')
          run.onActivity(`Could not remove managed MCP server ${registered[index]}`)
      })
    }
  },
}
