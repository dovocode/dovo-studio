import { checkedPolicyRun, toolPolicyDisposition } from '../shared/permission-policy.js'
import { opencodeNative } from './opencode-native.js'
import { mutableStruct } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { OwnedProcessShutdownError } from '../../execution/stop-owned-child.js'
import { mcpServerEnvironment, mcpHeaders } from '../../configuration/mcp-settings.js'
import { isImageAttachment } from '@dovo/protocol'
import { Schema } from 'effect'
import { questionPromptSchema } from '@dovo/protocol'
import { createOpencodeClient, type PermissionRuleset } from '@opencode-ai/sdk/v2'
import type { AgentAdapter } from '../../execution/types.js'
import {
  OpenCodeServers,
  opencodeHeaders,
  isOpencodeV2,
  type OpenCodeConnection,
} from './opencode-server.js'
import { opencodeV2Adapter } from './opencode-v2.js'
import { OpenCodeClientCache } from './client-cache.js'
import { readOpencodeThread } from './opencode-thread.js'
const clients = new OpenCodeClientCache<ReturnType<typeof createOpencodeClient>>()
function client(address: string, cwd?: string, env?: Record<string, string>, active = false) {
  const authorization = opencodeHeaders(env).Authorization
  const key = JSON.stringify([address, cwd, authorization])
  const create = () =>
    createOpencodeClient({
      baseUrl: address || 'http://127.0.0.1:4096',
      directory: cwd,
      throwOnError: true,
      headers: authorization ? { Authorization: authorization } : {},
    })
  return active
    ? clients.acquire(key, create)
    : { value: clients.get(key, create), release: () => {} }
}
/** Resolves false once the event stream is torn down, so a pending approval card cannot keep
 * the adapter's cleanup waiting after the turn itself already failed. */
function untilAborted(approval: Promise<boolean>, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false)
    const abort = () => resolve(false)
    signal.addEventListener('abort', abort, { once: true })
    approval
      .then(resolve, () => resolve(false))
      .finally(() => signal.removeEventListener('abort', abort))
  })
}
const remoteAdapter: AgentAdapter = {
  models: async (agent) => {
    if (await isOpencodeV2(agent.endpoint, agent.env)) return opencodeV2Adapter.models!(agent)
    const { data } = await client(agent.endpoint, undefined, agent.env).value.provider.list(
      {},
      {
        throwOnError: true,
        signal: AbortSignal.timeout(15000),
      },
    )
    return {
      harness: { name: 'OpenCode v1', generation: 'v1' },
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
      if (await isOpencodeV2(agent.endpoint, agent.env)) return opencodeV2Adapter.probe(agent)
      await client(agent.endpoint, undefined, agent.env).value.global.health({
        signal: AbortSignal.timeout(5000),
      })
      return {
        provider: 'opencode',
        available: true,
        detail: 'OpenCode v1 Serve is reachable.',
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
    run = checkedPolicyRun(run, 'opencode')
    run.signal.throwIfAborted()
    if (await isOpencodeV2(run.agent.endpoint, run.agent.env)) return opencodeV2Adapter.run(run)
    const lease = client(run.agent.endpoint, run.cwd, run.agent.env, true)
    const api = lease.value
    const registered: string[] = []
    let ephemeralSessionId: string | undefined
    let interruption: Promise<void> | undefined
    let removeAbortListener: (() => void) | undefined
    try {
      const namespace = `dovo_${createHash('sha256')
        // Attempt bindings change each turn; reuse the same managed MCP registration name.
        .update(
          JSON.stringify([run.cwd, run.agent.id, run.agent.resources], (key, value: unknown) =>
            key === 'DOVO_TASK_RUN_ID' ? undefined : value,
          ),
        )
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
              : toolPolicyDisposition(run, 'other') === 'allow'
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
      if (
        run.tools !== 'none' &&
        !run.agent.approvalPolicy &&
        run.agent.permission === 'workspace-write'
      )
        permission.push({
          permission: 'edit',
          pattern: '*',
          action: 'allow',
        })
      for (const link of run.linkedDirectories ?? []) {
        permission.push({
          permission: 'external_directory',
          pattern: `${link.path}/*`,
          action: 'allow',
        })
        if (link.access === 'read-only')
          permission.push({ permission: 'edit', pattern: `${link.path}/*`, action: 'deny' })
      }
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
              : toolPolicyDisposition(run, 'other') === 'allow'
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
      if (run.ephemeral && !run.sessionId) ephemeralSessionId = sessionID
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
      if (run.compact) {
        const slash = run.agent.model.indexOf('/')
        if (slash < 1 || slash === run.agent.model.length - 1)
          throw new Error('Choose an OpenCode provider/model before compacting')
        const result = await api.session.summarize(
          {
            sessionID,
            directory: run.cwd,
            providerID: run.agent.model.slice(0, slash),
            modelID: run.agent.model.slice(slash + 1),
          },
          { throwOnError: true, signal: run.signal },
        )
        if (!result.data) throw new Error('OpenCode did not compact the session')
        run.onPromptAccepted?.()
        run.onEvent?.('dovo/compaction/completed', { sessionID })
        return
      }
      const eventsController = new AbortController()
      const abort = () => {
        eventsController.abort()
        if (interruption) return
        interruption = (async () => {
          const stopped = await api.session.abort(
            {
              sessionID,
              directory: run.cwd,
            },
            {
              throwOnError: true,
              signal: AbortSignal.timeout(5000),
            },
          )
          if (!stopped.data) throw new Error('OpenCode did not accept the interruption')
          // Aborting the HTTP prompt does not prove that the server-side worker stopped.
          const signal = AbortSignal.timeout(5000)
          while (true) {
            const states = await api.session.status(
              { directory: run.cwd },
              { throwOnError: true, signal },
            )
            const state = states.data[sessionID]
            if (!state || state.type === 'idle') return
            await delay(100, undefined, { signal })
          }
        })()
        // The outer finalizer owns this rejection, including event subscription failures.
        void interruption.catch(() => undefined)
      }
      run.signal.addEventListener('abort', abort, {
        once: true,
      })
      removeAbortListener = () => run.signal.removeEventListener('abort', abort)
      if (run.signal.aborted) abort()
      const native = opencodeNative(
        run,
        sessionID,
        async (id) => {
          await api.session.abort(
            { sessionID: id, directory: run.cwd },
            { throwOnError: true, signal: AbortSignal.timeout(5000) },
          )
        },
        async () => {
          const states = await api.session.status(
            { directory: run.cwd },
            { throwOnError: true, signal: AbortSignal.timeout(5000) },
          )
          return new Set(
            Object.entries(states.data)
              .filter(([, state]) => state.type !== 'idle')
              .map(([id]) => id),
          )
        },
      )
      let succeeded = false
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
          native.update(event.type, event)
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
            prompting &&
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
            prompting &&
            event.type === 'message.part.updated' &&
            event.properties.sessionID === sessionID &&
            event.properties.part.type === 'text'
          )
            textParts.add(event.properties.part.id)
          if (
            prompting &&
            event.type === 'message.part.delta' &&
            event.properties.sessionID === sessionID &&
            event.properties.field === 'text' &&
            textParts.has(event.properties.partID)
          ) {
            streamed = true
            run.onText(event.properties.delta)
          }
          if (
            prompting &&
            event.type === 'message.part.updated' &&
            event.properties.sessionID === sessionID &&
            event.properties.part.type === 'text' &&
            event.properties.part.time?.end !== undefined
          )
            run.onTextBoundary?.()
          if (
            event.type === 'permission.asked' &&
            (event.properties.sessionID === sessionID || native.owns(event.properties.sessionID))
          ) {
            const allow =
              run.tools !== 'none' &&
              run.agent.permission !== 'read-only' &&
              (run.agent.approvalPolicy === 'never' ||
                (await untilAborted(
                  !prompting && event.properties.sessionID === sessionID
                    ? Promise.resolve(false)
                    : run
                        .approve(
                          event.properties.permission,
                          event.properties.patterns.join('\n'),
                          ['webfetch', 'websearch'].includes(event.properties.permission)
                            ? 'web'
                            : undefined,
                        )
                        .then((decision) => decision !== 'deny'),
                  eventsController.signal,
                )))
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
            (event.properties.sessionID === sessionID || native.owns(event.properties.sessionID))
          ) {
            const answers =
              !prompting && event.properties.sessionID === sessionID
                ? null
                : await run.ask(
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
                sessionID: event.properties.sessionID,
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
          for (const part of response.data.parts)
            if (part.type === 'text') {
              run.onText(part.text)
              run.onTextBoundary?.()
            }
        prompting = false
        await native.drain(consume)
        succeeded = true
      } catch (error) {
        abort()
        throw error
      } finally {
        try {
          await native.close(!succeeded, () => interruption)
        } finally {
          eventsController.abort()
        }
        run.signal.removeEventListener('abort', abort)
        await consume.catch((error) => {
          if (!eventsController.signal.aborted) throw error
        })
      }
    } finally {
      const finalize = async () => {
        let shutdownError: OwnedProcessShutdownError | undefined
        removeAbortListener?.()
        if (interruption)
          await interruption.catch((cause: unknown) => {
            shutdownError = new OwnedProcessShutdownError(
              'OpenCode shutdown was not confirmed. Review its session before continuing.',
              { cause },
            )
          })
        try {
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
          if (ephemeralSessionId && !shutdownError)
            await api.session.delete(
              { sessionID: ephemeralSessionId, directory: run.cwd },
              { signal: AbortSignal.timeout(5000), throwOnError: true },
            )
        } catch (error) {
          // Preserve the error that keeps checkout ownership when cleanup also fails.
          if (!shutdownError) throw error
        } finally {
          lease.release()
        }
        if (shutdownError) throw shutdownError
      }
      await finalize()
    }
  },
}

export function createOpenCodeAdapter(servers = new OpenCodeServers()): AgentAdapter {
  /** Holds the local server for the whole call so idle retirement cannot stop it mid-use. */
  const withServer = async <T extends import('@dovo/protocol').AgentDiscovery, R>(
    agent: T,
    use: (agent: T & OpenCodeConnection) => Promise<R>,
  ) => {
    const lease = await servers.acquire(agent)
    try {
      return await use(lease.agent)
    } finally {
      lease.release()
    }
  }
  return {
    readNativeThread: (agent, id, _sessionId, cwd) =>
      withServer(agent, (resolved) => readOpencodeThread(resolved, id, cwd)),
    models: (agent) => withServer(agent, (resolved) => remoteAdapter.models!(resolved)),
    probe: async (agent) => {
      try {
        return await withServer(agent, (resolved) => remoteAdapter.probe(resolved))
      } catch (error) {
        return {
          provider: 'opencode',
          available: false,
          detail: error instanceof Error ? error.message : 'OpenCode could not start',
        }
      }
    },
    run: async (run) => {
      run = checkedPolicyRun(run, 'opencode')
      const lease = await servers.acquire(run.agent, run.taskId, run.cwd)
      let completed = false
      let held = false
      try {
        await remoteAdapter.run({ ...run, agent: lease.agent })
        completed = true
      } catch (error) {
        // An unconfirmed stop keeps this turn's lease until the stop itself is confirmed.
        if (error instanceof OwnedProcessShutdownError && error.confirmed) {
          held = true
          void error.confirmed.then(() => lease.release())
        }
        throw error
      } finally {
        // Successful turns drained their native children; any failure waits for server confirmation.
        if (!held) lease.release(completed)
      }
    },
    releaseTask: (taskId) => servers.releaseTask(taskId),
    dispose: () => servers.dispose(),
  }
}
export const opencodeAdapter = createOpenCodeAdapter()
