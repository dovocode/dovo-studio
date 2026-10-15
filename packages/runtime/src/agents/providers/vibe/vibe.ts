import { spawn } from 'node:child_process'
import { createMessageConnection } from 'vscode-jsonrpc/node'
import { Schema } from 'effect'
import { decode, mutableStruct, effectivePermissionPolicy, isImageAttachment } from '@dovo/protocol'
import { processEnvironment } from '../../../process.js'
import type { AgentAdapter, AgentInput, AgentRun } from '../../execution/types.js'
import { stopOwnedChild } from '../../execution/stop-owned-child.js'
import { mcpHeaders, mcpServerEnvironment } from '../../configuration/mcp-settings.js'
import { vibeAuthenticated, vibeModels } from '../../catalogs/vibe.js'
import { checkedPolicyRun, toolPolicyDisposition } from '../shared/permission-policy.js'
import { nativeObject as object, nativeText as text, nativeWait } from '../shared/native.js'
import { JsonLineReader, JsonLineWriter } from '../codex/codex-transport.js'
import { patchVibeEntry, vibeConfig, vibeInitialize, vibeServerInfo } from './vibe-protocol.js'
import { vibeQuestions } from './vibe-questions.js'

const sessionResponse = mutableStruct({
  state: mutableStruct({ session: mutableStruct({ id: Schema.String }) }),
})
const turnResponse = mutableStruct({
  turn: mutableStruct({ id: Schema.String, status: Schema.String }),
})
const message = (input: Pick<AgentInput, 'prompt' | 'attachments'>) => [
  { type: 'text', text: input.prompt },
  ...(input.attachments ?? []).filter(isImageAttachment).map((file) => ({
    type: 'image',
    attachment: {
      source: { kind: 'file', path: file.path },
      alias: file.name,
      mimeType: file.mime,
    },
  })),
]

export function vibeSessionOptions(run: AgentRun) {
  const policy = effectivePermissionPolicy(run.agent)
  const enabledTools = policy.readOnly
    ? ['read_file', 'grep', 'skill', 'ask_user_question']
    : undefined
  return {
    cwd: run.cwd,
    workspaceRoots: [run.cwd, ...(run.linkedDirectories ?? []).map((link) => link.path)],
    // Avoid native auto-review bypassing Dovo's supervised decisions. Auto falls back to ask.
    agent: policy.readOnly
      ? 'plan'
      : policy.approvalPolicy === 'never'
        ? 'auto-approve'
        : policy.autoAcceptEdits
          ? 'accept-edits'
          : 'ask',
    autoApprove: !policy.readOnly && policy.approvalPolicy === 'never',
    headless: true,
    trustWorkspace: true,
    enabledTools,
    mcpServers: policy.readOnly
      ? []
      : (run.agent.resources?.mcpServers ?? [])
          .filter((server) => server.enabled)
          .map((server) =>
            server.transport === 'stdio'
              ? {
                  transport: 'stdio',
                  name: server.name,
                  command: server.command,
                  args: server.args,
                  env: mcpServerEnvironment(server),
                }
              : {
                  transport: 'http',
                  name: server.name,
                  url: server.url,
                  headers: mcpHeaders(server),
                },
          ),
  }
}

export function createVibeAdapter(): AgentAdapter {
  const active = new Set<() => Promise<void>>()
  return {
    models: vibeModels,
    async probe(agent) {
      try {
        const available = await vibeAuthenticated(agent)
        return {
          provider: 'vibe',
          available,
          detail: available
            ? 'Mistral Vibe app server is available with configured credentials.'
            : 'Configure Mistral Vibe credentials on this runtime host with vibe --setup.',
        }
      } catch (error) {
        return {
          provider: 'vibe',
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    },
    async run(run) {
      run = checkedPolicyRun(run, 'vibe')
      if (run.tools === 'none')
        throw new Error(
          'Mistral Vibe does not expose a tool-free unified session; choose another provider for utilities',
        )
      run.signal.throwIfAborted()
      const child = spawn(run.agent.endpoint || 'vibe-app-server', run.agent.args ?? [], {
        windowsHide: true,
        cwd: run.cwd,
        detached: process.platform !== 'win32',
        env: processEnvironment(run.agent.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const rpc = createMessageConnection(
        new JsonLineReader(child.stdout),
        new JsonLineWriter(child.stdin),
      )
      const lifetime = new AbortController()
      const signal = AbortSignal.any([run.signal, lifetime.signal])
      let stderr = ''
      let closing: Promise<void> | undefined
      let resolveTurn: () => void = () => {}
      let rejectTurn: (error: unknown) => void = () => {}
      const completed = new Promise<void>((resolve, reject) => {
        resolveTurn = resolve
        rejectTurn = reject
      })
      void completed.catch(() => {})
      let sessionId = ''
      let turnId = ''
      let admitting = false
      let submitted = false
      let finished = false
      let bufferedBytes = 0
      const buffered: Array<{ method: string; params: unknown }> = []
      const entries = new Map<string, Record<string, unknown>>()
      let emitted = ''
      const request = (method: string, params: object, timeout = 30000) =>
        nativeWait(rpc.sendRequest(method, params), signal, timeout)
      const close = () =>
        (closing ??= (async () => {
          lifetime.abort(new Error('Vibe app server closed'))
          rpc.dispose()
          await stopOwnedChild(child)
        })())
      active.add(close)
      const fail = (error: unknown) => {
        rejectTurn(error)
        lifetime.abort(error)
      }
      child.on('error', fail)
      child.on('exit', (code) => fail(new Error(`Vibe exited (${code}). ${stderr.trim()}`.trim())))
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + String(chunk)).slice(-4000)
      })
      rpc.onError(([error]) => fail(error))
      rpc.onClose(() => {
        if (!closing) fail(new Error(`Vibe connection closed. ${stderr.trim()}`.trim()))
      })
      const policy = effectivePermissionPolicy(run.agent)
      const publishEntry = (entry: Record<string, unknown>) => {
        if (entry.sessionId !== sessionId || entry.turnId !== turnId) return
        const id = text(entry.id)
        if (!id) throw new Error('Vibe sent a history entry without an ID')
        entries.set(id, entry)
        if (entry.type === 'message' && entry.role === 'assistant') {
          const output = [...entries.values()]
            .filter((item) => item.type === 'message' && item.role === 'assistant')
            .map((item) =>
              Array.isArray(item.content)
                ? item.content
                    .map((block: unknown) => {
                      const content = object(block)
                      return content.type === 'text' ? text(content.text) : ''
                    })
                    .join('\n\n')
                : '',
            )
            .filter(Boolean)
            .join('\n\n')
          if (output.startsWith(emitted)) run.onText(output.slice(emitted.length))
          else if (run.onTextReplace) run.onTextReplace(output, emitted.length)
          else
            throw new Error(
              'Vibe revised its streamed response but text replacement is unavailable',
            )
          emitted = output
        }
        if (entry.type === 'effect') {
          run.onEvent?.('vibe/effect', { entry })
          run.onActivity(text(entry.title) || text(object(entry.detail).toolName) || 'Vibe tool')
        }
        if (entry.type === 'reasoning') run.onEvent?.('vibe/reasoning', { entry })
      }
      const consume = (method: string, raw: unknown) => {
        const params = object(raw)
        if (params.sessionId !== sessionId || !submitted || finished) return
        if (admitting) {
          bufferedBytes += JSON.stringify(raw).length
          if (buffered.length >= 256 || bufferedBytes > 1024 * 1024)
            throw new Error('Vibe sent excessive events before identifying the active turn')
          buffered.push({ method, params: raw })
          return
        }
        const eventTurnId = text(params.turnId) || text(object(params.turn).id)
        if (eventTurnId && eventTurnId !== turnId) return
        run.onEvent?.(method, raw)
        if (method === 'history/entryAdded') publishEntry(object(params.entry))
        if (method === 'history/entryUpdated') {
          const id = text(params.entryId)
          const previous = entries.get(id)
          if (!previous) throw new Error(`Vibe updated unknown history entry ${id}`)
          publishEntry(patchVibeEntry(previous, params.patch))
        }
        if (method === 'turn/completed') {
          const turn = decode(turnResponse, params).turn
          finished = true
          run.onSteer?.(undefined)
          run.onNativeTurnEnd?.()
          if (turn.status === 'completed' && !object(params.turn).stopReason) resolveTurn()
          else
            rejectTurn(
              new Error(
                text(object(object(params.turn).error).message) ||
                  `Vibe turn ${text(object(params.turn).stopReason) || turn.status}`,
              ),
            )
        }
        if (method === 'session/statsUpdated') run.onEvent?.('vibe/usage', params)
      }
      rpc.onNotification((method, params) => {
        try {
          consume(method, params)
        } catch (error) {
          fail(error)
        }
      })
      rpc.onRequest(async (method, raw: unknown) => {
        if (method !== 'callback/call') throw new Error(`Unsupported Vibe request: ${method}`)
        const callback = object(object(raw).callback)
        if (
          !sessionId ||
          callback.sessionId !== sessionId ||
          finished ||
          !submitted ||
          run.signal.aborted
        )
          throw new Error('Vibe callback does not belong to the active session')
        // A callback may arrive before turn/start has returned its turn ID.
        if (!admitting && callback.turnId !== turnId)
          throw new Error('Vibe callback belongs to a retired turn')
        const callbackId = text(callback.callbackId)
        if (!callbackId) throw new Error('Vibe callback has no ID')
        const detail = object(callback.detail)
        // Acknowledge delivery immediately; Vibe expects the answer in a separate callback/result.
        void (async () => {
          let output: unknown
          if (detail.kind === 'user_input') output = await vibeQuestions(detail.request, run)
          else if (detail.kind === 'approval') {
            const effect = object(detail.effect)
            const kind = text(effect.kind)
            const operation = ['file_read', 'file_search', 'skill'].includes(kind)
              ? 'read'
              : ['file_edit', 'file_write'].includes(kind)
                ? 'edit'
                : kind === 'shell'
                  ? 'execute'
                  : 'other'
            const disposition = toolPolicyDisposition(run, operation)
            const decision =
              disposition === 'allow'
                ? 'approve'
                : disposition === 'deny'
                  ? 'deny'
                  : await run.approve(
                      text(callback.title) || 'Vibe tool request',
                      JSON.stringify(detail, null, 2),
                      undefined,
                      { session: false, always: false },
                    )
            output = {
              type: 'approval',
              decision: { type: decision === 'deny' ? 'deny' : 'approve' },
            }
          } else throw new Error(`Unsupported Vibe callback: ${text(detail.kind)}`)
          if (signal.aborted || finished) return
          await request('callback/result', { sessionId, result: { callbackId, output } })
        })().catch(fail)
        return { callbackId, accepted: true }
      })
      const abort = () => {
        rejectTurn(run.signal.reason ?? new Error('Task cancelled'))
      }
      run.signal.addEventListener('abort', abort, { once: true })
      rpc.listen()
      try {
        signal.throwIfAborted()
        decode(vibeServerInfo, await request('initialize', vibeInitialize))
        await rpc.sendNotification('initialized', {})
        const options = vibeSessionOptions(run)
        const response = decode(
          sessionResponse,
          await request(run.sessionId ? 'session/resume' : 'session/start', {
            ...(run.sessionId ? { sessionId: run.sessionId } : {}),
            agentConfig: options,
          }),
        )
        sessionId = response.state.session.id
        run.onSession(sessionId)
        await request('session/ready/wait', { sessionId })
        // Session-only overrides: never change the host's saved model or reasoning preferences.
        const { config } = decode(vibeConfig, await request('config/read', { sessionId }))
        const alias = run.agent.model || config.activeModel.alias
        const pointer = alias.replaceAll('~', '~0').replaceAll('/', '~1')
        const ops = [
          {
            op: 'set',
            path: '/bypass_tool_permissions',
            value: options.autoApprove,
            targetLayer: 'overrides',
          },
          ...(run.agent.model
            ? [{ op: 'set', path: '/active_model', value: alias, targetLayer: 'overrides' }]
            : []),
          ...(run.agent.reasoning
            ? [
                {
                  op: 'set',
                  path: `/models/${pointer}/thinking`,
                  value: run.agent.reasoning,
                  targetLayer: 'overrides',
                },
              ]
            : []),
        ]
        const changed = object(
          await request('config/write', { sessionId, ops, reloadRuntime: true }),
        )
        if (
          changed.status !== 'applied' ||
          changed.rejected === true ||
          (Array.isArray(changed.failures) && changed.failures.length)
        )
          throw new Error(
            `Vibe could not apply session settings: ${JSON.stringify(changed.failures ?? [])}`,
          )
        const effective = object(
          object(await request('config/effective/read', { sessionId })).config,
        )
        if (effective.bypass_tool_permissions !== options.autoApprove)
          throw new Error(
            'Vibe did not apply the requested approval policy; no prompt was submitted',
          )
        if (
          policy.readOnly &&
          JSON.stringify(effective.enabled_tools) !== JSON.stringify(options.enabledTools)
        )
          throw new Error('Vibe did not apply the read-only tool allowlist')
        if (run.agent.instructions)
          await request('session/context/inject', {
            sessionId,
            input: [{ type: 'text', text: run.agent.instructions }],
          })
        if (run.compact) {
          await request('session/compact', { sessionId }, 60000)
          run.onPromptAccepted?.()
          return
        }
        submitted = true
        admitting = true
        const started = decode(
          turnResponse,
          await request('turn/start', { sessionId, message: message(run) }),
        )
        turnId = started.turn.id
        run.onPromptAccepted?.()
        admitting = false
        for (const event of buffered.splice(0)) consume(event.method, event.params)
        if (!finished)
          run.onSteer?.(async (input) => {
            await request('turn/steer', {
              sessionId,
              expectedTurnId: turnId,
              clientUserMessageId: input.id,
              message: message(input),
            })
          })
        await nativeWait(completed, signal)
      } finally {
        run.onSteer?.(undefined)
        run.signal.removeEventListener('abort', abort)
        try {
          if (sessionId && turnId && !finished && !lifetime.signal.aborted)
            await nativeWait(
              rpc.sendRequest('turn/interrupt', { sessionId, expectedTurnId: turnId }),
              lifetime.signal,
              3000,
            )
        } finally {
          try {
            await close()
          } finally {
            active.delete(close)
          }
        }
      }
    },
    dispose: async () => {
      await Promise.all([...active].map((close) => close()))
    },
  }
}
