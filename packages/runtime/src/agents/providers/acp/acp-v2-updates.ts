import {
  ContentBlock,
  SessionUpdate,
  StateUpdate,
  PlanUpdateContent,
  type PlanEntry,
  type ToolCallUpdate,
  type UpdateSessionNotification,
} from '@agentclientprotocol/sdk/experimental/v2'
import type { AgentRun } from '../../execution/types.js'

function metadata(previous: ToolCallUpdate['_meta'], patch: ToolCallUpdate['_meta']) {
  if (patch === undefined) return previous
  if (patch === null) return null
  const result = { ...previous }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key]
    else result[key] = value
  }
  return result
}

/** Per-turn text projection. The original typed v2 updates remain in the event history. */
export class AcpV2Updates {
  private readonly messages = new Map<string, string>()
  private emitted = ''
  readonly tools = new Map<string, ToolCallUpdate>()
  private readonly terminals = new Map<
    string,
    { decoder: TextDecoder; text: string; exited: boolean; failed: boolean }
  >()
  private readonly plans = new Map<string, PlanEntry[]>()
  foregroundStarted = false
  background = false
  private active = true
  constructor(
    private run: AgentRun,
    private finish: (reason: string, error?: string) => void,
  ) {}

  begin(run: AgentRun, finish: (reason: string, error?: string) => void) {
    this.run = run
    this.finish = finish
    this.messages.clear()
    this.emitted = ''
    this.foregroundStarted = false
    this.active = true
  }

  private emit(name: string, payload: unknown, sessionId: string) {
    if (this.active) this.run.onEvent?.(name, payload)
    else this.run.onSubagentEvent?.(name, payload, sessionId)
  }

  tool(update: ToolCallUpdate, sessionId: string) {
    const previous = this.tools.get(update.toolCallId)
    const next = { ...previous, ...update, _meta: metadata(previous?._meta, update._meta) }
    this.tools.set(update.toolCallId, next)
    if (!previous && this.active) this.run.onTextBoundary?.()
    this.emit(
      'tool_call_update',
      {
        sessionId,
        update: { ...next, sessionUpdate: 'tool_call_update' },
      },
      sessionId,
    )
    if (next.title && this.active) this.run.onActivity(next.title)
  }

  accept(params: UpdateSessionNotification, active = true) {
    this.active = active
    const { update } = params
    this.emit('acp/v2/update', { protocolVersion: 2, notification: params }, params.sessionId)
    if (
      active &&
      (SessionUpdate.isUserMessage(update) || SessionUpdate.isUserMessageChunk(update))
    ) {
      this.foregroundStarted = true
      this.run.onPromptAccepted?.()
    }
    if (
      active &&
      (SessionUpdate.isAgentMessage(update) || SessionUpdate.isAgentMessageChunk(update))
    ) {
      const previous = this.messages.get(update.messageId) ?? ''
      const text = SessionUpdate.isAgentMessageChunk(update)
        ? previous + (ContentBlock.isText(update.content) ? update.content.text : '')
        : update.content === undefined
          ? previous
          : (update.content ?? [])
              .filter(ContentBlock.isText)
              .map((item) => item.text)
              .join('')
      this.messages.set(update.messageId, text)
      const output = [...this.messages.values()].join('')
      if (output.startsWith(this.emitted)) this.run.onText(output.slice(this.emitted.length))
      else if (this.run.onTextReplace) this.run.onTextReplace(output, this.emitted.length)
      else throw new Error('ACP v2 message replacement requires text replacement support')
      this.emitted = output
    }
    if (
      active &&
      (SessionUpdate.isAgentThought(update) || SessionUpdate.isAgentThoughtChunk(update))
    )
      this.emit('acp/v2/reasoning', params, params.sessionId)
    if (SessionUpdate.isToolCallUpdate(update)) this.tool(update, params.sessionId)
    if (SessionUpdate.isToolCallContentChunk(update)) {
      const previous = this.tools.get(update.toolCallId)
      this.tool(
        { toolCallId: update.toolCallId, content: [...(previous?.content ?? []), update.content] },
        params.sessionId,
      )
    }
    if (SessionUpdate.isPlanUpdate(update) && PlanUpdateContent.isItems(update.plan)) {
      this.plans.set(update.plan.planId, update.plan.entries)
      this.emit(
        'plan',
        {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'plan', entries: [...this.plans.values()].flat() },
        },
        params.sessionId,
      )
    }
    if (SessionUpdate.isTerminalUpdate(update) || SessionUpdate.isTerminalOutputChunk(update)) {
      let terminal = this.terminals.get(update.terminalId)
      if (!terminal) {
        terminal = { decoder: new TextDecoder(), text: '', exited: false, failed: false }
        this.terminals.set(update.terminalId, terminal)
      }
      if (SessionUpdate.isTerminalUpdate(update) && update.output !== undefined) {
        terminal.decoder = new TextDecoder()
        terminal.text = update.output
          ? terminal.decoder.decode(Buffer.from(update.output.data, 'base64'), { stream: true })
          : ''
      }
      if (SessionUpdate.isTerminalOutputChunk(update))
        terminal.text += terminal.decoder.decode(Buffer.from(update.data, 'base64'), {
          stream: true,
        })
      if (SessionUpdate.isTerminalUpdate(update) && update.exitStatus !== undefined) {
        terminal.exited = !!update.exitStatus
        terminal.failed =
          !!update.exitStatus &&
          ((update.exitStatus.exitCode != null && update.exitStatus.exitCode !== 0) ||
            !!update.exitStatus.signal)
        if (terminal.exited) terminal.text += terminal.decoder.decode()
      }
      terminal.text = terminal.text.slice(-262144)
      // Display output is a tool receipt. It never creates a local process or input route.
      this.emit(
        'tool_call_update',
        {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: `acp-terminal:${update.terminalId}`,
            title: 'Agent terminal',
            kind: 'execute',
            status: terminal.exited ? (terminal.failed ? 'failed' : 'completed') : 'in_progress',
            content: [{ type: 'content', content: { type: 'text', text: terminal.text } }],
          },
        },
        params.sessionId,
      )
    }
    if (SessionUpdate.isUsageUpdate(update)) this.emit('usage_update', params, params.sessionId)
    if (SessionUpdate.isStateUpdate(update)) {
      this.background = Array.isArray(update.background) && update.background.length > 0
      if (active && StateUpdate.isRunning(update)) this.foregroundStarted = true
      if (active && StateUpdate.isIdle(update) && this.foregroundStarted) {
        this.foregroundStarted = false
        this.finish(
          update.stopReason ?? 'end_turn',
          'error' in update &&
            update.error &&
            typeof update.error === 'object' &&
            'message' in update.error
            ? String(update.error.message)
            : undefined,
        )
      }
    }
  }
}
