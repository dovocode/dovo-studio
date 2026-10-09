import { homedir } from 'node:os'
import { Session, spawnMspConnection, readSessionDurability } from '@muse-code/sdk'
import { Schema } from 'effect'
import {
  decode,
  mutableArray,
  mutableStruct,
  questionPromptSchema,
  isImageAttachment,
  nativeAgentWorking,
  type Subagent,
} from '@dovo/protocol'
import type { AgentDiscovery } from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'
import { processEnvironment } from '../../../process.js'
import { mcpHeaders, mcpServerEnvironment } from '../../configuration/mcp-settings.js'
import { updateSubagents } from '../../execution/subagents.js'
import { releaseIdleProvider } from '../../execution/warm-processes.js'
import { nativeObject as object, nativeText as text, nativeWait } from '../shared/native.js'

const rows = mutableStruct({
  models: mutableArray(
    mutableStruct({
      modelId: Schema.String,
      providerId: Schema.String,
      displayLabel: Schema.String,
      variants: Schema.optional(
        Schema.Union([mutableArray(Schema.String), Schema.Literal('unknown')]),
      ),
      isDefault: Schema.optional(Schema.Boolean),
      defaultReasoningEffort: Schema.optional(Schema.String),
    }),
  ),
})
const promptSchema = mutableStruct({
  userInputId: Schema.String,
  questions: mutableArray(
    mutableStruct({
      id: Schema.String,
      header: Schema.String,
      question: Schema.String,
      options: mutableArray(
        mutableStruct({ label: Schema.String, description: Schema.optional(Schema.String) }),
      ),
      selection: mutableStruct({
        mode: Schema.Literals(['single', 'multiple']),
        minSelections: Schema.optional(Schema.Number),
        maxSelections: Schema.optional(Schema.Number),
      }),
    }),
  ),
})
function launch(agent: AgentDiscovery, cwd: string) {
  return spawnMspConnection({
    command: agent.endpoint || 'muse',
    args: agent.args?.length ? agent.args : ['serve'],
    cwd,
    env: processEnvironment(agent.env),
    connection: { frameLimitBytes: 32 * 1024 * 1024 },
  })
}
export function museSelection(model: string) {
  if (!model) return {}
  try {
    const selected: unknown = JSON.parse(model)
    return decode(mutableStruct({ providerId: Schema.String, modelId: Schema.String }), selected)
  } catch (error) {
    throw new Error('Select a provider-qualified Muse model from its catalog', { cause: error })
  }
}
export function createMuseAdapter(): AgentAdapter {
  const idle = new Map<
    string,
    {
      sessionId: string
      config: string
      resume: (run: AgentRun) => Promise<void>
      close: () => Promise<void>
      working: () => boolean
    }
  >()
  return {
    dispose: async () => {
      const sessions = [...idle.values()]
      idle.clear()
      await Promise.all(sessions.map((session) => session.close()))
    },
    async models(agent) {
      const host = launch(agent, homedir())
      try {
        const ready = await nativeWait(
          host.initialize({ clientInfo: { name: 'dovo-studio', version: '0.1.0' } }),
          new AbortController().signal,
          30000,
        )
        const catalog = decode(
          rows,
          await nativeWait(
            ready.connection.request('model/list'),
            new AbortController().signal,
            30000,
          ),
        )
        const models = catalog.models.map((row) => ({
          id: JSON.stringify({ providerId: row.providerId, modelId: row.modelId }),
          name: row.displayLabel || row.modelId,
          description: row.providerId,
          isDefault: row.isDefault,
          defaultReasoning: row.defaultReasoningEffort,
          reasoning: Array.isArray(row.variants)
            ? row.variants
                .filter((id): id is string => typeof id === 'string')
                .map((id) => ({ id, name: id }))
            : [],
        }))
        return {
          models,
          reasoning: [
            ...new Set(models.flatMap((model) => model.reasoning.map((effort) => effort.id))),
          ].map((id) => ({ id, name: id })),
        }
      } finally {
        await host.close()
      }
    },
    async probe(agent) {
      const host = launch(agent, homedir())
      try {
        const ready = await nativeWait(
          host.initialize({
            clientInfo: { name: 'dovo-studio', version: '0.1.0' },
            capabilities: { requestedCapabilities: ['sessionMcp'] },
          }),
          new AbortController().signal,
          30000,
        )
        return {
          provider: 'muse',
          available: ready.initializeResult.grantedCapabilities.includes('sessionMcp'),
          detail: ready.initializeResult.grantedCapabilities.includes('sessionMcp')
            ? 'Muse native MSP host is available. Authenticate using the Muse Code CLI on this runtime.'
            : 'Update Muse to a host that grants sessionMcp for Dovo tools.',
        }
      } catch (error) {
        return {
          provider: 'muse',
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        }
      } finally {
        await host.close()
      }
    },
    async run(inputRun) {
      let run = inputRun
      const config = JSON.stringify([run.agent, run.cwd, run.tools], (key, value: unknown) =>
        key === 'DOVO_TASK_RUN_ID' ? undefined : value,
      )
      const previous = run.taskId ? idle.get(run.taskId) : undefined
      if (previous && previous.sessionId === run.sessionId && previous.config === config)
        return previous.resume(run)
      if (previous) {
        if (previous.working())
          throw new Error('Stop native Muse agents before changing their session configuration')
        await previous.close()
        if (run.taskId) idle.delete(run.taskId)
      }
      run.signal.throwIfAborted()
      if (run.tools === 'none' || run.agent.permission === 'read-only')
        throw new Error(
          'Muse does not expose tool-free or read-only sessions. Choose another provider for restricted tasks and utilities.',
        )
      const host = launch(run.agent, run.cwd),
        lifetime = new AbortController()
      let signal = AbortSignal.any([run.signal, lifetime.signal])
      let session: Session | undefined,
        turnId = '',
        active = false,
        current = ''
      let nativeAgents: Subagent[] = []
      let succeeded = false
      let connection: Awaited<ReturnType<typeof host.initialize>> | undefined
      const sent = new Map<string, string>(),
        waitingInputs = new Map<string, AbortController>()
      let reject: (error: unknown) => void = () => {},
        resolveCompact: () => void = () => {}
      const failed = new Promise<never>((_, no) => {
        reject = no
      })
      void failed.catch(() => {})
      const buffered: Array<{ method: string; params?: unknown }> = []
      const answer = async (raw: unknown) => {
        const params = decode(promptSchema, raw)
        if (waitingInputs.has(params.userInputId) || !session || !connection) return
        const controller = new AbortController()
        waitingInputs.set(params.userInputId, controller)
        const scoped = AbortSignal.any([signal, controller.signal])
        try {
          const ask = active ? run.ask : run.nativeAgentInteractions?.ask
          if (!ask) return
          const answers = await ask(
            decode(questionPromptSchema, {
              title: 'Muse needs your input',
              questions: params.questions.map((question) => ({
                id: question.id,
                header: question.header,
                question: question.question,
                options: question.options.map((option) => ({
                  value: option.label,
                  label: option.label,
                  description: option.description,
                })),
                custom: true,
                multiple: question.selection.mode === 'multiple',
              })),
            }),
            scoped,
            (values) => {
              for (const question of params.questions) {
                const selected = values[question.id] ?? []
                if (
                  question.selection.maxSelections !== undefined &&
                  selected.length > question.selection.maxSelections
                )
                  throw new Error('Too many answers selected')
                if (selected.length < (question.selection.minSelections ?? 1))
                  throw new Error('Answer every Muse question')
              }
            },
          )
          if (controller.signal.aborted || lifetime.signal.aborted) return
          await nativeWait(
            connection.connection.command(answers ? 'userInput/answer' : 'userInput/cancel', {
              sessionId: session.sessionId,
              userInputId: params.userInputId,
              ...(answers
                ? {
                    answers: params.questions.map((question) => {
                      const selected = answers[question.id] ?? []
                      const free = selected.filter(
                        (value) => !question.options.some((option) => option.label === value),
                      )
                      if (free.length) {
                        if (selected.length !== 1 || free[0].length > 500)
                          throw new Error(
                            'Muse accepts one free-text answer of up to 500 characters',
                          )
                        return { questionId: question.id, freeText: free[0] }
                      }
                      return question.selection.mode === 'multiple'
                        ? { questionId: question.id, selectedLabels: selected }
                        : { questionId: question.id, selectedLabel: selected[0] }
                    }),
                  }
                : {}),
            }),
            scoped,
            30000,
          )
        } finally {
          waitingInputs.delete(params.userInputId)
        }
      }
      const notification = (event: { method: string; params?: unknown }) => {
        if (!session) {
          if (buffered.length >= 10000)
            reject(new Error('Muse session setup produced too many events'))
          else buffered.push(event)
          return
        }
        const params = object(event.params)
        if (params.sessionId !== session.sessionId || lifetime.signal.aborted) return
        try {
          session.apply(event)
          if (event.method === 'userInput/settled')
            waitingInputs.get(text(params.userInputId))?.abort()
          const itemId = text(params.itemId) || text(object(params.item).itemId)
          const folded = session.fold.items.get(itemId)
          if (folded?.kind === 'subagent') {
            const payload = { ...params, item: folded }
            nativeAgents = updateSubagents(
              nativeAgents,
              'muse',
              payload,
              new Date().toISOString(),
              event.method,
              session.sessionId,
            )
            run.onSubagentEvent?.(event.method, payload, session.sessionId)
          }
          if (
            event.method === 'userInput/requested' &&
            (active || nativeAgents.some(nativeAgentWorking))
          )
            void answer(event.params).catch(reject)
          if (!active) return
          run.onEvent?.(event.method, event.params)
          if (event.method.startsWith('item/')) {
            const itemId = text(params.itemId) || text(object(params.item).itemId)
            const item = session.fold.items.get(itemId)
            if (!item || (turnId && item.turnId !== turnId)) return
            if (item.kind === 'agentMessage') {
              const value = session.fold.items.accumulated(itemId, 'text') ?? item.text ?? ''
              const previous = sent.get(itemId) ?? ''
              if (!value.startsWith(previous))
                throw new Error('Muse replaced streamed message text')
              if (value.length > previous.length) {
                if (current && current !== itemId) run.onTextBoundary?.()
                current = itemId
                run.onText(value.slice(previous.length))
                sent.set(itemId, value)
              }
            }
            if (item.kind === 'toolCall' && event.method === 'item/started')
              run.onActivity(`Using ${item.tool || 'tool'}`)
            if (item.kind === 'compaction' && event.method === 'item/completed' && run.compact) {
              if (item.outcome !== 'compacted')
                reject(new Error(item.reason || 'Muse did not install a compacted context'))
              else {
                run.onEvent?.('dovo/compaction/completed', { sessionId: session.sessionId })
                resolveCompact()
              }
            }
          }
        } catch (error) {
          reject(error)
        }
      }
      host.onNotification(notification)
      host.onProtocolError(reject)
      host.onServerRequest(async (request) => {
        throw new Error(`Unsupported Muse server request: ${request.method}`)
      })
      try {
        connection = await nativeWait(
          host.initialize({
            clientInfo: { name: 'dovo-studio', version: '0.1.0' },
            capabilities: {
              requestedCapabilities: ['sessionMcp'],
              experimentalApi: false,
              userInputDialogs: true,
            },
          }),
          signal,
          30000,
        )
        if (!connection.initializeResult.grantedCapabilities.includes('sessionMcp'))
          throw new Error('Muse must grant sessionMcp to bind Dovo tools; update your Muse host')
        if (connection.fingerprintWarning)
          run.onActivity(
            'Muse host schema differs from the SDK; using its stable forward-compatible protocol',
          )
        const mcpServers = Object.fromEntries(
          (run.agent.resources?.mcpServers ?? [])
            .filter((server) => server.enabled)
            .map((server) => [
              server.name,
              server.transport === 'stdio'
                ? {
                    transport: 'stdio',
                    command: server.command,
                    args: server.args,
                    env: mcpServerEnvironment(server),
                  }
                : { transport: 'streamableHttp', url: server.url, headers: mcpHeaders(server) },
            ]),
        )
        const response = await nativeWait(
          connection.connection.command(
            run.sessionId ? 'session/resume' : 'session/start',
            run.sessionId
              ? { sessionId: run.sessionId, excludeItems: true, config: { mcpServers } }
              : {
                  workspaceRoot: run.cwd,
                  ...museSelection(run.agent.model),
                  approvalMode:
                    run.agent.permission === 'full-access' ? 'allowAll' : 'promptUnmatched',
                  config: { mcpServers },
                },
          ),
          signal,
          30000,
        )
        const identity = text(object(response.session).sessionId)
        if (!identity) throw new Error('Muse did not return a session identity')
        session = new Session({
          sessionId: identity,
          durability: readSessionDurability(connection.initializeResult),
          connection: connection.connection,
        })
        void connection.connection.closed
          .then(async () => {
            session?.hostExited({ kind: 'transportEof' })
            const error = new Error('Muse connection closed before the turn completed')
            lifetime.abort(error)
            reject(error)
            await host.close()
            if (session) run.onSubagentEvent?.('dovo/session/closed', {}, session.sessionId)
            if (run.taskId) idle.delete(run.taskId)
          })
          .catch((error) => console.error('Could not drain exited Muse host:', error))
        void host.exited.then((exit) =>
          reject(new Error(`Muse host exited (${exit.code ?? exit.signal})`)),
        )
        run.onSession(identity)

        session.onApproval(async (request) => {
          const automatic = run.agent.permission === 'full-access'
          const interactions = run.nativeAgentInteractions
          const native =
            request.subagentOrigin &&
            nativeAgents.some(
              (agent) =>
                agent.id === request.subagentOrigin?.subagentId && nativeAgentWorking(agent),
            )
          const approve = native
            ? interactions &&
              ((title: string, detail: string) =>
                interactions.approve(title, detail, lifetime.signal))
            : active
              ? run.approve
              : undefined
          const allowed =
            !lifetime.signal.aborted &&
            approve !== undefined &&
            (automatic || (await nativeWait(approve('Muse tool request', request.rawArgs), signal)))
          const choice = request.availableChoices.find((choice) =>
            allowed
              ? choice.decision === 'approved' && choice.scope === 'once'
              : choice.decision === 'denied' || choice.decision === 'abort',
          )
          if (!choice) throw new Error('Muse did not offer a safe one-time approval or denial')
          return { choiceId: choice.choiceId }
        })
        session.onApprovalError((failure) =>
          reject(new Error(`Muse approval failed: ${JSON.stringify(failure)}`)),
        )
        session.onGapError((failure) =>
          reject(
            new Error(`Muse event history could not be recovered: ${JSON.stringify(failure)}`),
          ),
        )
        for (const event of buffered) notification(event)
        if (run.sessionId) {
          if (
            text(object(response.session).workspaceRoot) &&
            text(object(response.session).workspaceRoot) !== run.cwd
          )
            throw new Error('Muse session belongs to another workspace; start a new thread')
          await nativeWait(
            connection.connection.command('session/setApprovalMode', {
              sessionId: identity,
              mode: run.agent.permission === 'full-access' ? 'allowAll' : 'promptUnmatched',
            }),
            signal,
            30000,
          )
          if (run.agent.model)
            await nativeWait(
              connection.connection.command('session/setModel', {
                sessionId: identity,
                ...museSelection(run.agent.model),
              }),
              signal,
              30000,
            )
        }
        if (run.agent.reasoning)
          await nativeWait(
            connection.connection.command('session/setReasoningEffort', {
              sessionId: identity,
              reasoningEffort: run.agent.reasoning,
            }),
            signal,
            30000,
          )
        const stopNative = async (id?: string) => {
          if (!connection) throw new Error('Muse connection is unavailable')
          for (const agent of nativeAgents.filter(
            (agent) => nativeAgentWorking(agent) && (!id || agent.id === id),
          ))
            await nativeWait(
              connection.connection.command('subagent/stop', {
                sessionId: identity,
                subagentId: agent.id,
              }),
              lifetime.signal,
              30000,
            )
        }
        const turnSession = session
        const turnConnection = connection
        const execute = async (next: AgentRun) => {
          run = next
          run.onNativeSession?.({ stop: stopNative }, identity)
          signal = AbortSignal.any([run.signal, lifetime.signal])
          const compactCompletion = new Promise<void>((yes) => {
            resolveCompact = yes
          })
          sent.clear()
          current = ''
          turnId = ''
          active = true
          if (next !== inputRun) run.onSession(identity)
          try {
            if (run.compact) {
              const result = await nativeWait(
                turnConnection.connection.command('session/compact', { sessionId: identity }),
                signal,
                30000,
              )
              if (result.status === 'noop')
                throw new Error(text(result.reason) || 'Muse has no compactable history')
              await nativeWait(Promise.race([compactCompletion, failed]), signal)
            } else {
              const input = (prompt: string, attachments = run.attachments) => [
                { type: 'text' as const, text: prompt },
                ...(attachments ?? []).filter(isImageAttachment).map((file) => ({
                  type: 'image' as const,
                  mediaType: file.mime,
                  base64Data: file.data,
                })),
              ]
              const turn = await nativeWait(
                turnSession.sendUserTurn({
                  input: input([run.agent.instructions, run.prompt].filter(Boolean).join('\n\n')),
                  ifBusy: 'queue',
                }),
                signal,
                30000,
              )
              turnId = turn.turnId
              run.onPromptAccepted?.()
              const rpc = turnConnection.connection
              run.onSteer?.(async (value) => {
                if (!active || signal.aborted) throw new Error('This Muse turn has ended')
                const result = await nativeWait(
                  rpc.command('turn/steer', {
                    sessionId: identity,
                    expectedTurnId: turnId,
                    input: input(value.prompt, value.attachments ?? []),
                  }),
                  signal,
                  30000,
                )
                if (result.turnId !== turnId || result.status !== 'accepted')
                  throw new Error('Muse did not accept steering for this turn')
              })
              const outcome = await nativeWait(Promise.race([turn.completed, failed]), signal)
              if (outcome.kind !== 'completed' || outcome.params.terminal !== 'completed')
                throw new Error(
                  outcome.kind === 'completed'
                    ? outcome.params.error?.message || `Muse turn ${outcome.params.terminal}`
                    : `Muse turn ${outcome.kind}`,
                )
            }
          } finally {
            active = false
            run.onNativeTurnEnd?.()
            run.onSteer?.(undefined)
          }
        }
        await execute(run)
        succeeded = true
        if (run.taskId) {
          const taskId = run.taskId
          const warm = {
            sessionId: identity,
            config,
            working: () => nativeAgents.some(nativeAgentWorking),
            close: async () => {
              idle.delete(taskId)
              lifetime.abort()
              for (const question of waitingInputs.values()) question.abort()
              await host.close()
              run.onSubagentEvent?.('dovo/session/closed', {}, identity)
            },
            resume: async (next: AgentRun) => {
              try {
                await execute(next)
              } catch (error) {
                await warm.close()
                throw error
              }
            },
          }
          idle.set(taskId, warm)
          if (releaseIdleProvider()) {
            const stale = [...idle.values()].find((session) => !session.working())
            if (stale) await stale.close()
          }
        }
      } finally {
        active = false
        if (!succeeded || !run.taskId) lifetime.abort()
        run.onSteer?.(undefined)
        if (!succeeded || !run.taskId)
          for (const question of waitingInputs.values()) question.abort()
        if (run.signal.aborted && connection && session && turnId)
          await nativeWait(
            connection.connection.command('turn/interrupt', {
              sessionId: session.sessionId,
              turnId,
            }),
            new AbortController().signal,
            2000,
          ).catch((error) =>
            run.onActivity(
              `Muse interrupt: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
        if (!succeeded || !run.taskId) {
          await host.close()
          if (session) run.onSubagentEvent?.('dovo/session/closed', {}, session.sessionId)
        }
      }
    },
  }
}
