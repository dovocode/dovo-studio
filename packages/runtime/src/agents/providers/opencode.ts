import { mutableStruct } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { createHash } from 'node:crypto'
import { mcpServerEnvironment, mcpHeaders } from '../mcp-settings.js'
import { isImageAttachment } from '@dovo/protocol'
import { Schema } from 'effect'
import { questionPromptSchema } from '@dovo/protocol'
import { createOpencodeClient, type PermissionRuleset } from '@opencode-ai/sdk/v2'
import type { AgentAdapter } from '../types.js'
function client(address: string, cwd?: string) {
  return createOpencodeClient({
    baseUrl: address || 'http://127.0.0.1:4096',
    directory: cwd,
    throwOnError: true,
    headers: process.env.OPENCODE_SERVER_PASSWORD
      ? {
          Authorization: `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`,
        }
      : {},
  })
}
export const opencodeAdapter: AgentAdapter = {
  models: async (agent) => {
    const { data } = await client(agent.endpoint).provider.list(
      {},
      {
        throwOnError: true,
        signal: AbortSignal.timeout(15000),
      },
    )
    return {
      models: data.all
        .filter((provider) => data.connected.includes(provider.id))
        .flatMap((provider) =>
          Object.values(provider.models).map((model) => ({
            id: `${provider.id}/${model.id}`,
            name: `${provider.name} / ${model.name}`,
            reasoning: Object.keys(model.variants ?? {}).map((id) => ({
              id,
              name: id,
            })),
          })),
        ),
      reasoning: [],
    }
  },
  probe: async (agent) => {
    try {
      await client(agent.endpoint).global.health({
        signal: AbortSignal.timeout(5000),
      })
      return {
        provider: 'opencode',
        available: true,
        detail: 'OpenCode Serve is reachable.',
      }
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
    const api = client(run.agent.endpoint, run.cwd)
    const registered: string[] = []
    try {
      const namespace = `dovo_${createHash('sha256')
        .update(JSON.stringify([run.cwd, run.agent.id, run.agent.resources]))
        .digest('hex')
        .slice(0, 12)}`
      for (const server of run.tools === 'none' ? [] : (run.agent.resources?.mcpServers ?? [])) {
        if (!server.enabled) continue
        const name = `${namespace}_${server.name}`
        registered.push(name)
        const connection = await api.mcp.add(
          {
            directory: run.cwd,
            name,
            config:
              server.transport === 'stdio'
                ? {
                    type: 'local',
                    command: [server.command, ...server.args],
                    environment: mcpServerEnvironment(server),
                    enabled: true,
                  }
                : {
                    type: 'remote',
                    url: server.url,
                    headers: mcpHeaders(server),
                    enabled: true,
                    oauth: false,
                  },
          },
          {
            throwOnError: true,
            signal: run.signal,
          },
        )
        const status = connection.data[name]
        if (status?.status !== 'connected')
          throw new Error(
            `MCP server ${server.name} could not connect (${status?.status ?? 'unknown status'}). Test its configuration in Settings.`,
          )
      }
      const permission: PermissionRuleset = [
        {
          permission: '*',
          pattern: '*',
          action:
            run.tools === 'none'
              ? 'deny'
              : run.agent.permission === 'full-access'
                ? 'allow'
                : run.agent.permission === 'read-only'
                  ? 'deny'
                  : 'ask',
        },
      ]
      if (run.tools !== 'none')
        for (const name of ['read', 'glob', 'grep', 'list', 'question'])
          permission.push({
            permission: name,
            pattern: '*',
            action: 'allow',
          })
      if (run.tools !== 'none' && run.agent.permission === 'workspace-write')
        permission.push({
          permission: 'edit',
          pattern: '*',
          action: 'allow',
        })
      permission.push({
        permission: 'dovo_*',
        pattern: '*',
        action: 'deny',
      })
      for (const name of registered)
        permission.push({
          permission: `${name}_*`,
          pattern: '*',
          action:
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
              directory: run.cwd,
              title: 'Dovo Studio task',
              permission,
            },
            {
              throwOnError: true,
              signal: run.signal,
            },
          )
        ).data.id
      if (run.sessionId)
        await api.session.update(
          {
            sessionID,
            directory: run.cwd,
            permission,
          },
          {
            throwOnError: true,
            signal: run.signal,
          },
        )
      run.onSession(sessionID)
      const eventsController = new AbortController()
      const abort = () => {
        eventsController.abort()
        void api.session
          .abort(
            {
              sessionID,
              directory: run.cwd,
            },
            {
              throwOnError: true,
              signal: AbortSignal.timeout(5000),
            },
          )
          .catch((error) => run.onActivity(`Could not interrupt OpenCode: ${String(error)}`))
      }
      run.signal.addEventListener('abort', abort, {
        once: true,
      })
      if (run.signal.aborted) abort()
      let prompting = false
      let streamed = false
      const textParts = new Set<string>()
      const events = await api.event.subscribe(
        {
          directory: run.cwd,
        },
        {
          signal: eventsController.signal,
        },
      )
      const consume = (async () => {
        for await (const event of events.stream) {
          const scope = decodeResult(
            mutableStruct({
              sessionID: Schema.optional(Schema.String),
              info: Schema.optional(
                mutableStruct({
                  sessionID: Schema.optional(Schema.String),
                  id: Schema.optional(Schema.String),
                }),
              ),
              part: Schema.optional(
                mutableStruct({
                  sessionID: Schema.optional(Schema.String),
                }),
              ),
            }),
            event.properties,
          )
          if (
            scope.success &&
            (scope.data.sessionID === sessionID ||
              scope.data.info?.sessionID === sessionID ||
              scope.data.info?.id === sessionID ||
              scope.data.part?.sessionID === sessionID)
          ) {
            if (
              prompting &&
              (event.type === 'message.part.updated' ||
                event.type === 'message.part.delta' ||
                event.type === 'permission.asked' ||
                event.type === 'question.asked')
            )
              run.onPromptAccepted?.()
            run.onEvent?.(event.type, event)
          }
          if (
            event.type === 'message.part.updated' &&
            event.properties.sessionID === sessionID &&
            event.properties.part.type === 'text'
          )
            textParts.add(event.properties.part.id)
          if (
            event.type === 'message.part.delta' &&
            event.properties.sessionID === sessionID &&
            event.properties.field === 'text' &&
            textParts.has(event.properties.partID)
          ) {
            streamed = true
            run.onText(event.properties.delta)
          }
          if (event.type === 'permission.asked' && event.properties.sessionID === sessionID) {
            const allow =
              run.agent.permission !== 'read-only' &&
              (await run.approve(event.properties.permission, event.properties.patterns.join('\n')))
            await api.permission.reply(
              {
                requestID: event.properties.id,
                directory: run.cwd,
                reply: allow ? 'once' : 'reject',
              },
              {
                throwOnError: true,
                signal: run.signal,
              },
            )
          }
          if (
            (event.type === 'question.asked' || event.type === 'question.v2.asked') &&
            event.properties.sessionID === sessionID
          ) {
            const answers = await run.ask(
              decode(questionPromptSchema, {
                title: 'Agent needs your input',
                questions: event.properties.questions.map((q, i) => ({
                  ...q,
                  id: String(i),
                  options: q.options.map((o) => ({
                    ...o,
                    value: o.label,
                  })),
                })),
              }),
              eventsController.signal,
            )
            if (eventsController.signal.aborted) break
            const parameters = {
              requestID: event.properties.id,
              directory: run.cwd,
            }
            if (event.type === 'question.v2.asked') {
              const target = {
                sessionID,
                requestID: event.properties.id,
              }
              if (answers)
                await api.v2.session.question.reply(
                  {
                    ...target,
                    questionV2Reply: {
                      answers: event.properties.questions.map((_, i) => answers[String(i)] ?? []),
                    },
                  },
                  {
                    throwOnError: true,
                    signal: run.signal,
                  },
                )
              else
                await api.v2.session.question.reject(target, {
                  throwOnError: true,
                  signal: run.signal,
                })
              continue
            }
            if (answers)
              await api.question.reply(
                {
                  ...parameters,
                  answers: event.properties.questions.map((_, i) => answers[String(i)] ?? []),
                },
                {
                  throwOnError: true,
                  signal: run.signal,
                },
              )
            else
              await api.question.reject(parameters, {
                throwOnError: true,
                signal: run.signal,
              })
          }
        }
      })()
      const eventFailure = consume.then(() => {
        run.signal.throwIfAborted()
        throw new Error('OpenCode event stream closed before the turn completed')
      })
      // Attach immediately; Promise.race below propagates stream failures.
      void eventFailure.catch(() => undefined)
      try {
        if (run.signal.aborted) throw new Error('Task cancelled')
        const slash = run.agent.model.indexOf('/')
        if (run.agent.model && slash < 1)
          throw new Error('OpenCode models use provider/model format')
        prompting = true
        const response = await Promise.race([
          eventFailure,
          api.session.prompt(
            {
              sessionID,
              directory: run.cwd,
              system: run.agent.instructions,
              ...(run.agent.reasoning
                ? {
                    variant: run.agent.reasoning,
                  }
                : {}),
              ...(run.agent.model
                ? {
                    model: {
                      providerID: run.agent.model.slice(0, slash),
                      modelID: run.agent.model.slice(slash + 1),
                    },
                  }
                : {}),
              parts: [
                {
                  type: 'text',
                  text: run.prompt,
                },
                ...(run.attachments ?? []).filter(isImageAttachment).map((file) => ({
                  type: 'file' as const,
                  mime: file.mime,
                  filename: file.name,
                  url: `data:${file.mime};base64,${file.data}`,
                })),
              ],
            },
            {
              throwOnError: true,
              signal: run.signal,
            },
          ),
        ])
        run.onPromptAccepted?.()
        run.onEvent?.('prompt.result', response.data)
        if (response.data.info.error) throw new Error(JSON.stringify(response.data.info.error))
        if (!streamed)
          for (const part of response.data.parts) if (part.type === 'text') run.onText(part.text)
      } catch (error) {
        abort()
        throw error
      } finally {
        eventsController.abort()
        run.signal.removeEventListener('abort', abort)
        await consume.catch((error) => {
          if (!eventsController.signal.aborted) throw error
        })
      }
    } finally {
      const results = await Promise.allSettled(
        registered.map((name) =>
          api.mcp.disconnect(
            {
              name,
              directory: run.cwd,
            },
            {
              throwOnError: true,
              signal: AbortSignal.timeout(5000),
            },
          ),
        ),
      )
      results.forEach((result, index) => {
        if (result.status === 'rejected')
          run.onActivity(`Could not disconnect managed MCP server ${registered[index]}`)
      })
    }
  },
}
