import { mutableStruct } from '@dovo/protocol'
import { decodeResult, decode } from '@dovo/protocol'
import { codexMcpServers } from '../mcp-settings.js'
import { isImageAttachment, serviceTierValue } from '@dovo/protocol'
import { supportsCodexDaybreak } from '../codex-modes.js'
import { codexModels } from '../catalogs/codex.js'
import { codexQuestions, codexAsyncQuestions } from './codex-questions.js'
import { formQuestions } from './form-questions.js'
import { stopChild } from '../stop-child.js'
import { spawn } from 'node:child_process'
import { createMessageConnection } from 'vscode-jsonrpc/node'
import { Schema } from 'effect'
import type { AgentAdapter, AgentInput } from '../types.js'
import { executableAvailable, processEnvironment } from '../../process.js'
import { JsonLineReader, JsonLineWriter } from './codex-transport.js'
const turnInput = (input: Pick<AgentInput, 'prompt' | 'attachments'>) => [
  {
    type: 'text',
    text: input.prompt,
    text_elements: [],
  },
  ...(input.attachments ?? []).filter(isImageAttachment).map((file) => ({
    type: 'localImage',
    path: file.path,
  })),
]
const object = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
)
export const codexAdapter: AgentAdapter = {
  models: codexModels,
  probe: async (agent) => ({
    provider: 'codex',
    available: await executableAvailable(agent.endpoint || 'codex'),
    detail: 'Codex app-server executable; authentication uses the host’s Codex login.',
  }),
  async run(run) {
    run.signal.throwIfAborted()
    const child = spawn(run.agent.endpoint || 'codex', ['app-server', '--listen', 'stdio://'], {
      cwd: run.cwd,
      env: processEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const rpc = createMessageConnection(
      new JsonLineReader(child.stdout),
      new JsonLineWriter(child.stdin),
    )
    const questionItems = new Set<string>()
    let threadId = run.sessionId
    let turnFinished = false
    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr = (stderr + String(data)).slice(-4000)
    })
    let resolveTurn: () => void = () => {},
      rejectTurn: (error: Error) => void = () => {}
    const completed = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve
      rejectTurn = reject
    })
    // Attach a rejection handler immediately; the turn may fail during initialization.
    void completed.catch(() => {})
    child.on('error', rejectTurn)
    child.on('exit', (code) => {
      rpc.dispose()
      rejectTurn(new Error(`Codex exited (${code}). ${stderr}`))
    })
    rpc.onRequest(async (method, params: unknown, token) => {
      run.onEvent?.(method, params)
      if (
        method === 'item/commandExecution/requestApproval' ||
        method === 'item/fileChange/requestApproval'
      ) {
        const allowed =
          run.agent.permission !== 'read-only' &&
          (await run.approve(
            method.includes('command') ? 'Run command' : 'Apply file changes',
            JSON.stringify(params, null, 2),
          ))
        return {
          decision: allowed ? 'accept' : 'decline',
        }
      }
      if (method === 'item/permissions/requestApproval')
        return {
          permissions: {},
          scope: 'turn',
        }
      if (method === 'item/tool/requestUserInput' || method === 'mcpServer/elicitation/request') {
        const controller = new AbortController()
        const cancellation = token.onCancellationRequested(() => controller.abort())
        if (token.isCancellationRequested) controller.abort()
        try {
          if (method === 'item/tool/requestUserInput')
            return await codexQuestions(params, run, controller.signal)
          const form = decodeResult(
            mutableStruct({
              mode: Schema.Literal('form'),
              message: Schema.String,
              requestedSchema: Schema.Unknown,
            }),
            params,
          )
          if (!form.success) {
            run.onActivity('This Codex MCP input request is not a supported form')
            return {
              action: 'cancel',
              content: null,
              _meta: null,
            }
          }
          const content = await formQuestions(
            form.data.message,
            form.data.requestedSchema,
            run,
            controller.signal,
          )
          return {
            action: content ? 'accept' : 'decline',
            content,
            _meta: null,
          }
        } finally {
          cancellation.dispose()
        }
      }
      throw new Error(`Unsupported Codex request: ${method}`)
    })
    rpc.onNotification((method, params: unknown) => {
      run.onEvent?.(method, params)
      const value = decodeResult(object, params)
      if (!value.success) return
      // Child notifications feed the Agents panel, never the parent transcript or completion.
      if (threadId && typeof value.data.threadId === 'string' && value.data.threadId !== threadId)
        return
      if (method === 'item/agentMessage/delta' && typeof value.data.delta === 'string')
        run.onText(value.data.delta)
      if ((method === 'item/started' || method === 'item/completed') && run.onQuestions) {
        const form = codexAsyncQuestions(value.data.item)
        if (form && !questionItems.has(form.id)) {
          questionItems.add(form.id)
          run.onQuestions(form.prompt)
        }
      }
      if (method === 'item/started') {
        const item = decodeResult(object, value.data.item)
        if (item.success && typeof item.data.type === 'string') run.onActivity(item.data.type)
      }
      if (method === 'turn/completed') {
        turnFinished = true
        run.onSteer?.(undefined)
        const turn = decode(
          mutableStruct({
            status: Schema.String,
            error: Schema.optional(
              Schema.NullOr(
                mutableStruct({
                  message: Schema.String,
                }),
              ),
            ),
          }),
          value.data.turn,
        )
        if (turn.status === 'completed') resolveTurn()
        else rejectTurn(new Error(turn.error?.message ?? `Turn ${turn.status}`))
      }
    })
    const abort = () => {
      stopChild(child)
      rejectTurn(new Error('Task cancelled'))
    }
    run.signal.addEventListener('abort', abort, {
      once: true,
    })
    const timeout = setTimeout(() => {
      stopChild(child)
      rejectTurn(new Error('Codex initialization timed out'))
    }, 30000)
    rpc.listen()
    try {
      if (run.signal.aborted) throw new Error('Task cancelled')
      const initialized = await rpc.sendRequest('initialize', {
        clientInfo: {
          name: 'dovo_studio',
          title: 'Dovo Studio',
          version: '0.1.0',
        },
        // Structured request_user_input is part of the experimental app-server surface.
        capabilities: {
          experimentalApi: true,
        },
      })
      await rpc.sendNotification('initialized', {})
      const program = run.tools === 'none' ? undefined : run.agent.cyberAccessProgram
      if (program && !supportsCodexDaybreak(initialized))
        throw new Error(
          'Daybreak mode requires Codex 0.155.1 or newer. Update the harness or choose Automatic.',
        )
      const tier = serviceTierValue(run.agent.serviceTier)
      const config = {
        ...(['priority', 'fast'].includes(tier)
          ? {
              'features.fast_mode': true,
            }
          : {}),
        ...(run.tools === 'none'
          ? {
              'features.shell_tool': false,
              web_search: 'disabled',
            }
          : run.agent.resources?.mcpServers.length
            ? {
                mcp_servers: codexMcpServers(run.agent.resources.mcpServers),
              }
            : {}),
      }
      const response = await rpc.sendRequest(run.sessionId ? 'thread/resume' : 'thread/start', {
        ...(run.sessionId
          ? {
              threadId: run.sessionId,
            }
          : {}),
        cwd: run.cwd,
        ...(run.agent.model
          ? {
              model: run.agent.model,
            }
          : {}),
        serviceTier: tier,
        ...(Object.keys(config).length
          ? {
              config,
            }
          : {}),
        ...(run.tools === 'none'
          ? {
              ephemeral: true,
            }
          : {}),
        developerInstructions: run.agent.instructions,
        approvalPolicy: ['read-only', 'full-access'].includes(run.agent.permission)
          ? 'never'
          : 'on-request',
        approvalsReviewer: run.agent.permission === 'auto' ? 'auto_review' : 'user',
        sandbox:
          run.agent.permission === 'full-access'
            ? 'danger-full-access'
            : ['workspace-write', 'auto'].includes(run.agent.permission)
              ? 'workspace-write'
              : 'read-only',
      })
      if (
        run.agent.permission === 'auto' &&
        !decodeResult(
          mutableStruct({
            approvalsReviewer: Schema.Literal('auto_review', 'guardian_subagent'),
          }),
          response,
        ).success
      )
        throw new Error(
          'This Codex harness did not enable automatic approval review. Update the harness or choose another access mode.',
        )
      if (
        run.agent.permission === 'full-access' &&
        !decodeResult(
          mutableStruct({
            approvalPolicy: Schema.Literal('never'),
            sandbox: mutableStruct({
              type: Schema.Literal('dangerFullAccess'),
            }),
          }),
          response,
        ).success
      )
        throw new Error(
          'This Codex harness did not grant full access. Check its policy or choose another access mode.',
        )
      const thread = decode(
        mutableStruct({
          thread: mutableStruct({
            id: Schema.String,
            daybreakEnabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
          }),
        }),
        response,
      ).thread
      threadId = thread.id
      run.onSession(thread.id)
      if (
        run.tools !== 'none' &&
        (program || (supportsCodexDaybreak(initialized) && thread.daybreakEnabled === true))
      )
        await rpc.sendRequest('thread/metadata/update', {
          threadId: thread.id,
          daybreakEnabled: !!program && program !== 'standard',
        })
      clearTimeout(timeout)
      const started = await rpc.sendRequest('turn/start', {
        threadId: thread.id,
        ...(run.agent.reasoning
          ? {
              effort: run.agent.reasoning,
            }
          : {}),
        serviceTier: tier,
        ...(program
          ? {
              cyberAccessProgram: program,
            }
          : {}),
        input: turnInput(run),
      })
      const turn = decodeResult(
        mutableStruct({
          turn: mutableStruct({
            id: Schema.String,
            status: Schema.String,
          }),
        }),
        started,
      )
      if (!turnFinished && turn.success && turn.data.turn.status === 'inProgress') {
        const expectedTurnId = turn.data.turn.id
        run.onSteer?.(async (input) => {
          run.signal.throwIfAborted()
          await rpc.sendRequest('turn/steer', {
            threadId: thread.id,
            expectedTurnId,
            clientUserMessageId: input.id,
            input: turnInput(input),
          })
        })
      }
      await completed
    } finally {
      run.onSteer?.(undefined)
      clearTimeout(timeout)
      run.signal.removeEventListener('abort', abort)
      rpc.dispose()
      stopChild(child)
    }
  },
}
