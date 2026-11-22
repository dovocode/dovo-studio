import { configureAcpV2 } from './acp-v2-config.js'
import { grokSteering } from './grok-steering.js'
import {
  SessionUpdate,
  RequestError,
  RequestPermissionSubject,
  type NewSessionResponse,
  type ResumeSessionResponse,
} from '@agentclientprotocol/sdk/experimental/v2'
import { isImageAttachment } from '@dovo/protocol'
import type { AgentRun, AcpLaunch } from '../../execution/types.js'
import { acpMcpServers } from '../../configuration/mcp-settings.js'
import { checkedPolicyRun } from '../shared/permission-policy.js'
import { acpPermissionDisposition, acpPermissionProvider } from './acp-permissions.js'
import { formQuestions } from '../shared/form-questions.js'
import { IdleProviders, releaseIdleProvider } from '../../execution/warm-processes.js'
import { openAcpV2Connection, AcpV1Fallback } from './acp-v2-connection.js'
import { NativeForegroundCancelled, NativeSessionBusyError } from '../../execution/handover.js'
import { AcpV2Updates } from './acp-v2-updates.js'

type Connection = ReturnType<typeof openAcpV2Connection>
type Session = NewSessionResponse | ResumeSessionResponse

type Warm = {
  connection: Connection
  session: Session
  sessionId: string
  key: string
  image: boolean
  state: {
    run: AgentRun
    updates?: AcpV2Updates
    prompting: boolean
    resuming: boolean
    compact: boolean
    configOptions?: Session['configOptions']
    foreground?: string
    idle?: () => void
    cancelled?: () => void
    fail?: (message: string) => void
  }
}

function working(value: Warm) {
  return (
    !!value.state.updates?.background ||
    (!!value.state.foreground && value.state.foreground !== 'idle')
  )
}

export function createAcpV2Adapter() {
  const shutdown = new WeakMap<Connection, Promise<void>>()
  const close = (connection: Connection, state: Warm['state'], sessionId?: string) => {
    const pending = shutdown.get(connection)
    if (pending) return pending
    const closing = connection.close().then(() => {
      if (sessionId) state.run.onSubagentEvent?.('dovo/session/closed', {}, sessionId)
    })
    shutdown.set(connection, closing)
    return closing
  }
  const release = (value: Warm) => close(value.connection, value.state, value.sessionId)
  const idle = new IdleProviders<Warm>(release, working)
  return {
    releaseTask: (taskId: string) => idle.release(taskId),
    beforeV1: async (taskId: string) => {
      const held = idle.get(taskId)
      if (held && working(held))
        throw new NativeSessionBusyError(
          'Stop ACP background work before changing protocol versions',
        )
      await idle.release(taskId)
    },
    dispose: async () => {
      const values = [...idle.values()]
      idle.clear()
      await Promise.all(values.map(release))
    },
    /** False means explicit v1 negotiation. No session or prompt has been sent. */
    async run(input: AgentRun, launch: AcpLaunch): Promise<boolean> {
      const run = checkedPolicyRun(input, 'acp')
      const permissionProvider = acpPermissionProvider(launch, run.agent)
      run.signal.throwIfAborted()
      const key = JSON.stringify([launch, run.agent, run.tools, run.cwd])
      const previous = run.taskId ? idle.get(run.taskId) : undefined
      if (run.taskId) idle.delete(run.taskId)
      let warm =
        previous?.key === key &&
        previous.sessionId === run.sessionId &&
        !previous.connection.signal.aborted
          ? previous
          : undefined
      if (previous && !warm) {
        if (working(previous)) {
          if (run.taskId) idle.set(run.taskId, previous)
          throw new NativeSessionBusyError(
            'Stop ACP background work before changing its session configuration',
          )
        }
        await release(previous)
      }
      const state: Warm['state'] = warm?.state ?? {
        run,
        prompting: false,
        resuming: false,
        compact: false,
      }
      state.run = run
      state.resuming = !!warm
      let sessionId = warm?.sessionId ?? run.sessionId
      let synchronized = !!warm || !run.sessionId
      let cancelling = false
      let acknowledgedCancellation = false
      const sessionUpdates = state.updates ?? new AcpV2Updates(run, () => {})
      state.updates = sessionUpdates
      sessionUpdates.attach(run)
      const interactionPhase = () => {
        if (state.prompting) return 'prompt'
        if (state.resuming && state.foreground && state.foreground !== 'idle') return 'resume'
      }
      const connection =
        warm?.connection ??
        openAcpV2Connection(
          launch,
          {
            permission: async ({ params }) => {
              const owner = state.run
              const phase = interactionPhase()
              if (!phase || params.sessionId !== sessionId || owner.signal.aborted)
                return { outcome: { outcome: 'cancelled' } }
              const subject = params.subject
              let operation: 'read' | 'edit' | 'execute' | 'other' = 'other'
              if (subject && RequestPermissionSubject.isToolCall(subject)) {
                if (phase === 'prompt') state.updates?.tool(subject.toolCall, params.sessionId)
                const kind = subject.toolCall.kind
                operation = ['read', 'search', 'think'].includes(kind ?? '')
                  ? 'read'
                  : kind === 'edit'
                    ? 'edit'
                    : 'other'
              } else if (subject && RequestPermissionSubject.isCommand(subject))
                operation = 'execute'
              const disposition = acpPermissionDisposition(owner, operation, permissionProvider)
              const allow =
                disposition === 'allow' ||
                (disposition === 'ask' &&
                  (await owner.approve(
                    params.title,
                    [params.description, JSON.stringify(subject, null, 2)]
                      .filter(Boolean)
                      .join('\n'),
                    operation === 'execute' ? 'command' : undefined,
                  )) !== 'deny')
              if (owner.signal.aborted || owner !== state.run || phase !== interactionPhase())
                return { outcome: { outcome: 'cancelled' } }
              const option = params.options.find(
                (option) => option.kind === (allow ? 'allow_once' : 'reject_once'),
              )
              return {
                outcome: option
                  ? { outcome: 'selected', optionId: option.optionId }
                  : { outcome: 'cancelled' },
              }
            },
            elicitation: async ({ params }) => {
              const owner = state.run
              const phase = interactionPhase()
              if (
                !phase ||
                !('sessionId' in params) ||
                params.sessionId !== sessionId ||
                owner.signal.aborted ||
                params.mode !== 'form'
              )
                return { action: 'cancel' }
              const content = await formQuestions(
                params.message,
                params.requestedSchema,
                owner,
                owner.signal,
              )
              if (owner.signal.aborted || owner !== state.run || phase !== interactionPhase())
                return { action: 'cancel' }
              return content ? { action: 'accept', content } : { action: 'decline' }
            },
            update: (params) => {
              if (params.sessionId !== sessionId) return
              if (SessionUpdate.isStateUpdate(params.update)) {
                state.foreground = params.update.state
                synchronized = true
              }
              if (SessionUpdate.isAvailableCommandsUpdate(params.update))
                state.compact = params.update.availableCommands.some(
                  (command) => command.name === 'compact',
                )
              if (SessionUpdate.isConfigOptionUpdate(params.update))
                state.configOptions = params.update.configOptions
              try {
                sessionUpdates.accept(params, state.prompting, synchronized)
              } catch (error) {
                state.fail?.(error instanceof Error ? error.message : String(error))
              }
              if (SessionUpdate.isStateUpdate(params.update) && params.update.state === 'idle') {
                if (params.update.stopReason === 'cancelled') state.cancelled?.()
                state.idle?.()
              }
            },
          },
          run.cwd,
        )
      run.onOwnedProcess?.(connection.child)
      if (!warm)
        void connection.exited
          .catch(async () => {
            await close(connection, state, sessionId)
            for (const [taskId, value] of idle)
              if (value.connection === connection) idle.delete(taskId)
          })
          .catch((error: unknown) => console.error('Could not close ACP v2 connection:', error))
      let retained = false
      let ephemeralDelete = false
      let abortTimer: ReturnType<typeof setTimeout> | undefined
      const cancellation = new Promise<void>((resolve) => {
        state.cancelled = () => {
          if (!cancelling) return
          acknowledgedCancellation = true
          resolve()
        }
      })
      const abort = () => {
        cancelling = true
        if (sessionId) {
          void connection.rpc.notify('session/cancel', { sessionId }).catch(() => {})
          abortTimer = setTimeout(() => {
            void connection.close()
          }, 1500)
          abortTimer.unref()
        } else void connection.close()
      }
      const registerSession = (id: string) => {
        run.onSession(id)
        run.onNativeSession?.(
          {
            foregroundCancellation: true,
            stop: async (childId) => {
              if (childId) throw new Error('Stop the ACP v2 session to stop its background work')
              try {
                await connection.control(
                  connection.rpc.request('session/close', { sessionId: id }),
                  'session close',
                )
              } finally {
                await close(connection, state, id)
                if (run.taskId && idle.get(run.taskId)?.connection === connection)
                  idle.delete(run.taskId)
              }
            },
          },
          id,
        )
      }
      const waitForIdle = async () => {
        if (!state.foreground || state.foreground === 'idle') return
        run.onActivity('Waiting for the existing ACP foreground work to finish')
        const ready = new Promise<void>((resolve) => {
          state.idle = resolve
        })
        try {
          await Promise.race([ready, connection.exited])
        } finally {
          state.idle = undefined
        }
        run.signal.throwIfAborted()
      }
      let completed = false
      const retain = () => {
        if (
          warm &&
          run.taskId &&
          !run.ephemeral &&
          run.tools !== 'none' &&
          !connection.signal.aborted
        ) {
          idle.set(run.taskId, warm)
          retained = true
        }
      }
      run.signal.addEventListener('abort', abort, { once: true })
      try {
        if (!warm) {
          let initialization
          try {
            initialization = await connection.initialize()
          } catch (error) {
            if (error instanceof AcpV1Fallback) return false
            throw error
          }
          const capabilities = initialization.capabilities?.session
          if (!capabilities) throw new Error('This ACP v2 agent does not support sessions')
          ephemeralDelete = !!capabilities.delete
          if (run.ephemeral && !ephemeralDelete)
            throw new Error('This ACP v2 agent cannot delete temporary sessions')
          const mcpServers = acpMcpServers(run.agent.resources?.mcpServers ?? []).map((server) =>
            server.type === 'http' ? server : { ...server, type: 'stdio' as const },
          )
          for (const server of mcpServers) {
            const kind = 'type' in server ? server.type : 'stdio'
            if (
              (kind === 'stdio' && !capabilities.mcp?.stdio) ||
              (kind === 'http' && !capabilities.mcp?.http)
            )
              throw new Error(`This ACP v2 agent does not support ${kind} MCP servers`)
          }
          state.resuming = !!run.sessionId
          if (run.sessionId) registerSession(run.sessionId)
          const session = await connection.control(
            run.sessionId
              ? connection.rpc.request('session/resume', {
                  sessionId: run.sessionId,
                  cwd: run.cwd,
                  mcpServers,
                })
              : connection.rpc.request('session/new', { cwd: run.cwd, mcpServers }),
            'session setup',
          )
          const returnedId = 'sessionId' in session ? session.sessionId : undefined
          sessionId = run.sessionId ?? (typeof returnedId === 'string' ? returnedId : undefined)
          if (!sessionId) throw new Error('ACP v2 agent did not return a session id')
          state.compact =
            session.availableCommands?.some((command) => command.name === 'compact') ??
            state.compact
          warm = {
            connection,
            session,
            sessionId,
            key,
            state,
            image: launch.authentication === 'grok' || !!capabilities.prompt?.image,
          }
          if (!run.sessionId) registerSession(sessionId)
          const id = sessionId
          await waitForIdle()
          await configureAcpV2(
            connection,
            id,
            state.configOptions ?? session.configOptions,
            run.agent,
            run.tools === 'none',
            permissionProvider,
          )
        }
        run.signal.throwIfAborted()
        if (previous === warm) registerSession(warm.sessionId)
        await waitForIdle()
        if (run.compact && !state.compact)
          throw new Error('This ACP agent does not advertise a compact command')
        let finish: (reason: string, error?: string) => void = () => {}
        const finished = new Promise<{ reason: string; error?: string }>((resolve) => {
          finish = (reason, error) => {
            if (reason !== 'error') state.prompting = false
            resolve({ reason, error })
          }
        })
        sessionUpdates.begin(run, finish)
        state.fail = (message) => finish('error', message)
        state.resuming = false
        state.prompting = true
        if (launch.authentication === 'grok')
          run.onSteer?.(
            grokSteering(
              run,
              warm.sessionId,
              () => state.run === run && state.prompting && !connection.signal.aborted,
              (params) =>
                connection.control(
                  connection.rpc.request('_x.ai/interject', params),
                  'Grok interjection',
                ),
            ),
          )
        if (!warm.image && run.attachments?.some(isImageAttachment) && run.tools === 'none')
          throw new Error('This ACP agent does not accept image input for tool-free reviews.')
        // The response only acknowledges insertion. Only a subsequent foreground idle state ends work.
        const inserted = await Promise.race([
          connection.rpc.request('session/prompt', {
            sessionId: warm.sessionId,
            prompt: [
              ...(warm.image
                ? (run.attachments ?? []).filter(isImageAttachment).map((file) => ({
                    type: 'image' as const,
                    data: file.data,
                    mimeType: file.mime,
                  }))
                : []),
              {
                type: 'text',
                text: run.compact
                  ? '/compact'
                  : [run.agent.instructions, run.prompt].filter(Boolean).join('\n\n'),
              },
            ],
          }),
          connection.exited,
        ]).catch(async (error: unknown) => {
          // ACP rejects a held prompt when cancel withdraws it. The rejection
          // can precede the idle snapshot that confirms foreground cancellation.
          if (!cancelling || !(error instanceof RequestError) || error.code !== -32800) throw error
          await Promise.race([cancellation, connection.exited])
          return undefined
        })
        if (!inserted) return true
        run.onPromptAccepted?.()
        if (!warm.image && run.attachments?.some(isImageAttachment))
          run.onActivity('ACP v2 attachments are available as files in the prompt context.')
        const result = await Promise.race([finished, connection.exited])
        if (result.reason !== 'end_turn' && !(cancelling && result.reason === 'cancelled'))
          throw new Error(result.error ?? `ACP v2 stopped: ${result.reason}`)
        run.onTextBoundary?.()
        if (run.compact && !cancelling) run.onEvent?.('dovo/compaction/completed', { sessionId })
        run.onNativeTurnEnd?.()
        completed = true
        return true
      } catch (error) {
        if (!run.signal.aborted && warm && working(warm) && !connection.signal.aborted) {
          retain()
          throw new NativeSessionBusyError(error instanceof Error ? error.message : String(error))
        }
        throw error
      } finally {
        if (state.prompting && sessionId) state.updates?.flush(sessionId)
        state.resuming = false
        state.prompting = false
        run.onSteer?.(undefined)
        state.fail = undefined
        state.cancelled = undefined
        clearTimeout(abortTimer)
        run.signal.removeEventListener('abort', abort)
        const keepCancelled = acknowledgedCancellation && sessionUpdates.background
        if (keepCancelled || (completed && !run.signal.aborted)) retain()
        if (retained) {
          await idle.prune(releaseIdleProvider())
          if (keepCancelled) throw new NativeForegroundCancelled()
        } else {
          try {
            if (sessionId && !connection.signal.aborted && !run.signal.aborted) {
              try {
                await connection.control(
                  connection.rpc.request('session/close', { sessionId }),
                  'session close',
                )
              } catch (error) {
                run.onActivity(
                  `ACP v2 session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
                )
              }
            }
            if (
              run.ephemeral &&
              !run.sessionId &&
              sessionId &&
              ephemeralDelete &&
              !connection.signal.aborted
            )
              await connection.control(
                connection.rpc.request('session/delete', { sessionId }),
                'session deletion',
              )
          } finally {
            await close(connection, state, sessionId)
          }
        }
      }
    },
  }
}
