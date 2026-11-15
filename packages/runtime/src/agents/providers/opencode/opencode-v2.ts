import { opencodeJobs } from './opencode-jobs.js'
import { opencodeEvents } from './opencode-events.js'
import { opencodeGoal } from './opencode-goal.js'
import { gte, valid } from 'semver'
import { decodeResult, mutableStruct, nativeTodos } from '@dovo/protocol'
import { Schema } from 'effect'
import { checkedPolicyRun, toolPolicyDisposition } from '../shared/permission-policy.js'
import { opencodeNative } from './opencode-native.js'
import { OwnedProcessShutdownError } from '../../execution/stop-owned-child.js'
import { createHash } from 'node:crypto'
import { waitForMcpConnection } from './mcp-readiness.js'
import { OpenCode } from '@opencode/client'
import { opencodeHeaders, opencodeAddress } from './opencode-server.js'
import { decode, isImageAttachment, questionPromptSchema } from '@dovo/protocol'
import { mcpHeaders, mcpServerEnvironment } from '../../configuration/mcp-settings.js'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'
import { OpenCodeClientCache } from './client-cache.js'

const clients = new OpenCodeClientCache<ReturnType<typeof OpenCode.make>>()
const client = (address: string, env?: Record<string, string>, active = false) => {
  const baseUrl = opencodeAddress(address)
  const authorization = opencodeHeaders(env)
  const key = JSON.stringify([baseUrl, authorization])
  const create = () => OpenCode.make({ baseUrl, headers: authorization })
  return active
    ? clients.acquire(key, create)
    : { value: clients.get(key, create), release: () => {} }
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
    const { data } = await client(agent.endpoint, agent.env).value.model.list(undefined, {
      signal: AbortSignal.timeout(15000),
    })
    return {
      harness: { name: 'OpenCode v2', generation: 'v2' },
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
      await client(agent.endpoint, agent.env).value.server.info({
        signal: AbortSignal.timeout(5000),
      })
      return { provider: 'opencode', available: true, detail: 'OpenCode v2 Serve is reachable.' }
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
    const lease = client(run.agent.endpoint, run.agent.env, true)
    const api = lease.value
    const registered: string[] = []
    let ephemeralSessionId: string | undefined
    const location = { directory: run.cwd }
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
        await waitForMcpConnection(
          server.name,
          async (signal) =>
            (await api.mcp.list({ location }, { signal })).data.find((item) => item.name === name)
              ?.status,
          run.signal,
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
              : toolPolicyDisposition(run, 'other') === 'allow'
                ? 'allow'
                : 'ask',
        },
      ]
      if (run.tools !== 'none') {
        for (const action of ['read', 'glob', 'grep', 'list', 'question'])
          permissions.push({ action, resource: '*', effect: 'allow' })
        if (!run.agent.approvalPolicy && run.agent.permission === 'workspace-write')
          permissions.push({ action: 'edit', resource: '*', effect: 'allow' })
      }
      for (const link of run.linkedDirectories ?? []) {
        permissions.push({
          action: 'external_directory',
          resource: `${link.path}/**`,
          effect: 'allow',
        })
        if (link.access === 'read-only')
          permissions.push({ action: 'edit', resource: `${link.path}/**`, effect: 'deny' })
      }
      permissions.push({ action: 'dovo_*', resource: '*', effect: 'deny' })
      for (const name of registered)
        permissions.push({
          action: `${name}_*`,
          resource: '*',
          effect:
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
              title: 'Dovo Studio task',
              ...(run.agent.model ? { model: modelOf(run) } : {}),
              location,
              permissions,
            },
            { signal: run.signal },
          )
        ).id
      if (run.ephemeral && !run.sessionId) ephemeralSessionId = sessionID
      if (run.sessionId) {
        const active = await api.session.active({ signal: run.signal })
        if (active[sessionID]) {
          await api.session.interrupt({ sessionID }, { signal: run.signal })
          await api.session.wait(
            { sessionID },
            { signal: AbortSignal.any([run.signal, AbortSignal.timeout(10000)]) },
          )
        }
        await api.session.update({ sessionID, permissions }, { signal: run.signal })
        if (run.agent.model)
          await api.session.switchModel({ sessionID, model: modelOf(run) }, { signal: run.signal })
      }
      if (run.sessionId && !run.compact) {
        try {
          const baseline = await api.session.get({ sessionID }, { signal: run.signal })
          run.onEvent?.('dovo/usage/baseline', { tokens: baseline.tokens, cost: baseline.cost })
        } catch (cause) {
          console.warn('OpenCode turn usage baseline unavailable:', cause)
          run.onEvent?.('dovo/usage/unavailable', {})
        }
      }
      run.onSession(sessionID)
      if (run.agent.instructions)
        await api.session.instructions.entry.put(
          { sessionID, key: 'dovo-agent', value: run.agent.instructions },
          { signal: run.signal },
        )
      let supportsGoals = false
      const goal = opencodeGoal(run, api, sessionID)
      const streamController = new AbortController()
      let interruption: Promise<void> | undefined
      const abort = () => {
        streamController.abort()
        interruption = (async () => {
          try {
            if (supportsGoals && goal.active) {
              await api.session.command(
                { sessionID, name: 'goal', text: 'pause' },
                { signal: AbortSignal.timeout(5000) },
              )
              await goal.read(AbortSignal.timeout(5000))
              if (goal.active) throw new Error('OpenCode goal pause was not confirmed')
            }
          } finally {
            await api.session.interrupt({ sessionID }, { signal: AbortSignal.timeout(5000) })
            await api.session.wait({ sessionID }, { signal: AbortSignal.timeout(5000) })
          }
        })()
        // The cleanup below owns the rejection, including failures before it is awaited.
        void interruption.catch(() => undefined)
      }
      run.signal.addEventListener('abort', abort, { once: true })
      if (run.signal.aborted) abort()
      const names = new Map<string, string>()
      const inputs = new Map<string, Record<string, unknown>>()
      const reasoning = new Map<string, string>()
      const text = new Map<string, { received: string; ended: boolean }>()
      const replied = new Set<string>()
      let resolveDone!: () => void
      let rejectDone!: (reason: Error) => void
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve
        rejectDone = reject
      })
      const interactions = new Map<string, { session: string; controller: AbortController }>()
      let rejectInteraction!: (cause: Error) => void
      const interactionFailure = new Promise<never>((_resolve, reject) => {
        rejectInteraction = reject
      })
      void interactionFailure.catch(() => undefined)
      const cancelInteractions = (session?: string) => {
        for (const pending of interactions.values())
          if (!session || pending.session === session) pending.controller.abort()
      }
      const interact = (
        key: string,
        session: string,
        operation: (signal: AbortSignal) => Promise<void>,
      ) => {
        if (replied.has(key) || interactions.has(key)) return
        const controller = new AbortController()
        const signal = AbortSignal.any([streamController.signal, controller.signal, run.signal])
        interactions.set(key, { session, controller })
        void Promise.resolve()
          .then(() => operation(signal))
          .then(() => {
            replied.add(key)
          })
          .catch((cause: unknown) => {
            if (signal.aborted) return
            const error = cause instanceof Error ? cause : new Error(String(cause))
            rejectDone(error)
            rejectInteraction(error)
          })
          .finally(() => {
            interactions.delete(key)
          })
      }
      let resolveConnected!: () => void
      const connected = new Promise<void>((resolve) => {
        resolveConnected = resolve
      })
      void done.catch(() => undefined)
      const cancelDone = () => rejectDone(new Error('Task cancelled'))
      run.signal.addEventListener('abort', cancelDone, { once: true })
      if (run.signal.aborted) cancelDone()
      const jobs = opencodeJobs(run, api, sessionID, (id) => native.owns(id))
      const native = opencodeNative(
        run,
        sessionID,
        async (id) => {
          await api.session.interrupt({ sessionID: id }, { signal: AbortSignal.timeout(5000) })
        },
        async () =>
          new Set(Object.keys(await api.session.active({ signal: AbortSignal.timeout(5000) }))),
        jobs,
      )
      let succeeded = false
      let parentFinished = false
      let accepted = false
      let awaitingStart = !run.compact
      let submitted = false
      let executionFinished = false
      let recoveringText = false
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
      const recoverTodos = async () => {
        const history = await api.message.list(
          { sessionID, type: 'assistant', order: 'desc', limit: 100 },
          { signal: AbortSignal.any([run.signal, AbortSignal.timeout(5000)]) },
        )
        for (const message of history.data) {
          if (message.type !== 'assistant') continue
          for (const part of [...message.content].reverse()) {
            if (
              part.type !== 'tool' ||
              part.name !== 'todowrite' ||
              part.state.status !== 'completed'
            )
              continue
            const todoEvent = { properties: { sessionID, todos: part.state.metadata?.todos } }
            if (nativeTodos('todo.updated', todoEvent, 'opencode', [], sessionID)) {
              run.onEvent?.('todo.updated', todoEvent)
              return
            }
          }
        }
      }
      const consume = (async () => {
        for await (const event of opencodeEvents(
          api,
          sessionID,
          streamController.signal,
          () => ({ submitted, parentFinished, children: native.activeSessions() }),
          (text) => run.onActivity(text),
        )) {
          native.update(event.type, event)
          if (event.type === 'server.connected') {
            if (submitted) {
              recoveringText = true
              await jobs.refresh()
              if (supportsGoals) {
                await goal.read()
                await recoverTodos()
              }
            }
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
          const child = typeof eventSession === 'string' && native.owns(eventSession)
          if ((!child && eventSession !== sessionID) || !submitted) continue
          if (
            child &&
            (event.type === 'session.shell.started' ||
              event.type === 'session.shell.ended' ||
              event.type === 'session.inbox.enqueued')
          )
            await jobs.refresh()
          if (event.type === 'form.replied' || event.type === 'form.cancelled') {
            interactions.get(`form:${event.data.sessionID}:${event.data.id}`)?.controller.abort()
            continue
          }
          if (
            child &&
            [
              'session.execution.succeeded',
              'session.execution.failed',
              'session.execution.interrupted',
              'session.idle',
            ].includes(event.type)
          )
            cancelInteractions(eventSession)
          if (child && event.type !== 'permission.asked' && event.type !== 'form.created') continue
          if (
            event.type === 'rpc.opencode.goal.changed' &&
            eventSession === sessionID &&
            supportsGoals
          ) {
            const changed = decodeResult(mutableStruct({ goal: Schema.Unknown }), data)
            if (changed.success) {
              try {
                goal.publish(changed.data.goal)
              } catch {
                await goal.read()
              }
              if (executionFinished && !goal.active) resolveDone()
            }
            continue
          }
          if (
            event.type === 'session.shell.started' ||
            event.type === 'session.shell.ended' ||
            event.type === 'session.inbox.enqueued'
          )
            await jobs.refresh()
          if (parentFinished && !child) continue
          // Session-only terminal events can belong to a retired execution. Admission
          // starts at the new execution's start, never at the HTTP acknowledgement.
          if (awaitingStart && !child) {
            if (event.type !== 'session.execution.started') continue
            awaitingStart = false
          }
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
            case 'session.execution.started':
              executionFinished = false
              break
            case 'session.text.delta': {
              if (recoveringText) break
              const id = `${event.data.assistantMessageID}:${event.data.ordinal}`
              const previous = text.get(id)
              if (previous?.ended) break
              text.set(id, {
                received: (previous?.received ?? '') + event.data.delta,
                ended: false,
              })
              run.onText(event.data.delta)
              break
            }
            case 'session.text.ended': {
              const id = `${event.data.assistantMessageID}:${event.data.ordinal}`
              const previous = text.get(id)?.received ?? ''
              // Durable end events restore deltas lost in a transport outage.
              if (typeof event.data.text === 'string') {
                if (!event.data.text.startsWith(previous))
                  throw new Error('OpenCode recovered text differs. Review the saved session.')
                run.onText(event.data.text.slice(previous.length))
                text.set(id, { received: event.data.text, ended: true })
              }
              run.onTextBoundary?.()
              break
            }
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
            case 'session.tool.success': {
              if (names.get(event.data.id) === 'todowrite') {
                const todoEvent = { properties: { sessionID, todos: event.data.metadata?.todos } }
                if (nativeTodos('todo.updated', todoEvent, 'opencode', [], sessionID))
                  run.onEvent?.('todo.updated', todoEvent)
              }
              await jobs.refresh()
              emitTool(
                event.data.id,
                'completed',
                event.data.content
                  .map((part) => (part.type === 'text' ? part.text : ''))
                  .join('\n'),
              )
              break
            }
            case 'session.tool.failed':
              emitTool(event.data.id, 'error', event.data.error.message)
              break
            case 'session.execution.succeeded':
              cancelInteractions(sessionID)
              executionFinished = true
              if (supportsGoals) await goal.read()
              if (!run.compact && !goal.active) resolveDone()
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
              const request = event.data
              const key = `permission:${request.sessionID}:${request.id}`
              interact(key, request.sessionID, async (signal) => {
                const kind = ['webfetch', 'websearch', 'web_fetch', 'web_search'].includes(
                  request.action,
                )
                  ? 'web'
                  : undefined
                const decision = async () =>
                  child && run.nativeAgentInteractions
                    ? run.nativeAgentInteractions.approve(
                        request.message || request.action,
                        request.resources.join('\n'),
                        signal,
                        kind,
                      )
                    : run.approve(
                        request.message || request.action,
                        request.resources.join('\n'),
                        kind,
                      )
                const allow =
                  run.tools !== 'none' &&
                  run.agent.permission !== 'read-only' &&
                  (run.agent.approvalPolicy === 'never' || (await decision()) !== 'deny')
                if (signal.aborted) return
                await api.permission.reply(
                  {
                    sessionID: request.sessionID,
                    requestID: request.id,
                    decision: allow ? 'once' : 'reject',
                  },
                  { signal },
                )
              })
              break
            }
            case 'form.created': {
              const form = event.data.form
              const key = `form:${form.sessionID}:${form.id}`
              interact(key, form.sessionID, async (signal) => {
                const ask =
                  child && run.nativeAgentInteractions ? run.nativeAgentInteractions.ask : run.ask
                const answers = await ask(
                  decode(questionPromptSchema, {
                    title: form.title,
                    questions: form.fields.map((field) => ({
                      id: field.key,
                      header: field.title || field.key,
                      question: field.description || field.title || field.key,
                      options: 'options' in field ? field.options : [],
                      multiple: field.type === 'multiselect',
                      custom:
                        !('options' in field && field.options?.length) ||
                        ('custom' in field && field.custom === true),
                      inputType:
                        field.type === 'number' || field.type === 'integer' ? 'number' : 'text',
                      secret: 'hidden' in field && field.hidden === true,
                      required: !('required' in field) || field.required !== false,
                    })),
                  }),
                  signal,
                )
                if (signal.aborted) return
                if (answers)
                  await api.session.form.reply(
                    {
                      sessionID: form.sessionID,
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
                    { signal },
                  )
                else
                  await api.session.form.cancel(
                    {
                      sessionID: form.sessionID,
                      formID: form.id,
                      ...(child
                        ? {
                            message:
                              'The user dismissed this question. Continue without an answer.',
                          }
                        : {}),
                    },
                    { signal },
                  )
              })
              break
            }
          }
        }
        if (!streamController.signal.aborted)
          rejectDone(new Error('OpenCode event stream closed before the turn completed'))
      })()
      void consume.catch((cause: unknown) =>
        rejectDone(cause instanceof Error ? cause : new Error(String(cause))),
      )
      try {
        await Promise.race([connected, done])
        const info = await api.server.info({
          signal: AbortSignal.any([run.signal, AbortSignal.timeout(5000)]),
        })
        supportsGoals = !!valid(info.version) && gte(info.version, '2.2.5')
        run.onEvent?.('dovo/opencode/capabilities', { sessionId: sessionID, goals: supportsGoals })
        await jobs.initialize(!!valid(info.version) && gte(info.version, '2.2.6'))
        if (run.sessionId && !run.compact && supportsGoals) {
          await recoverTodos()
          if (supportsGoals) await goal.read()
        }
        submitted = true
        if (run.goal) {
          const controlOnly = await goal.control()
          if (!controlOnly) await done
          parentFinished = true
          await Promise.race([
            Promise.all([native.drain(consume), jobs.drain(consume)]),
            interactionFailure,
          ])
          succeeded = true
          return
        }
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
        parentFinished = true
        await Promise.race([
          Promise.all([native.drain(consume), jobs.drain(consume)]),
          interactionFailure,
        ])
        succeeded = true
      } finally {
        if (!succeeded && !interruption) abort()
        try {
          await native.close(!succeeded)
        } finally {
          cancelInteractions()
          streamController.abort()
        }
        run.signal.removeEventListener('abort', abort)
        run.signal.removeEventListener('abort', cancelDone)
        const drained = consume.catch((error) => {
          if (!streamController.signal.aborted) throw error
        })
        if (interruption)
          await Promise.all([drained, interruption]).catch((cause: unknown) => {
            throw new OwnedProcessShutdownError(
              'OpenCode shutdown was not confirmed. Review its session before continuing.',
              { cause },
            )
          })
        await drained
      }
    } finally {
      try {
        const results = await Promise.allSettled(
          registered.map((server) =>
            api.mcp.remove({ server, location }, { signal: AbortSignal.timeout(5000) }),
          ),
        )
        results.forEach((result, index) => {
          if (result.status === 'rejected')
            run.onActivity(`Could not remove managed MCP server ${registered[index]}`)
        })
        if (ephemeralSessionId)
          await api.session.remove(
            { sessionID: ephemeralSessionId },
            { signal: AbortSignal.timeout(5000) },
          )
      } finally {
        lease.release()
      }
    }
  },
}
