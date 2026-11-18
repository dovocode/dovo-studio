import {
  BackgroundWork,
  ContentBlock,
  SessionUpdate,
  StateUpdate,
  PlanUpdateContent,
  type PlanEntry,
  type ToolCallUpdate,
  type UpdateSessionNotification,
} from '@agentclientprotocol/sdk/experimental/v2'
import { toolContentText } from '@dovo/protocol'
import type { AgentRun } from '../../execution/types.js'

// The activity list keeps the latest progress receipt. Keep enough context to read it.
function tail(text: string, limit = 1024) {
  const start = Math.max(0, text.length - limit)
  const code = text.charCodeAt(start)
  return text.slice(start > 0 && code >= 0xdc00 && code <= 0xdfff ? start + 1 : start)
}

function textContent(text: string): NonNullable<ToolCallUpdate['content']> {
  return [{ type: 'content', content: { type: 'text', text } }]
}

function retainToolOutput(tool: ToolCallUpdate) {
  const content = tool.content
  const length = content?.length ?? 0
  // Later chunks append to this array even if the execution no longer accepts events.
  return () => toolContentText(content?.slice(0, length))
}

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
  private lastMessageId: string | undefined
  readonly tools = new Map<string, ToolCallUpdate>()
  private readonly terminals = new Map<
    string,
    { decoder: TextDecoder; text: string; exited: boolean; failed: boolean }
  >()
  private readonly toolPreviews = new Map<string, string>()
  private readonly streamedTerminals = new Set<string>()
  private readonly plans = new Map<string, PlanEntry[]>()
  private readonly sessionMessages = new Map<string, string>()
  private backgroundItems = new Map<string, { terminalId?: string; toolCallId?: string }>()
  foregroundStarted = false
  private active = true
  private publish = true
  constructor(
    private run: AgentRun,
    private finish: (reason: string, error?: string) => void,
  ) {}

  get background() {
    return this.backgroundItems.size > 0
  }

  attach(run: AgentRun) {
    this.run = run
    this.active = false
  }

  begin(run: AgentRun, finish: (reason: string, error?: string) => void) {
    this.run = run
    this.finish = finish
    this.messages.clear()
    this.emitted = ''
    this.lastMessageId = undefined
    this.foregroundStarted = false
    this.active = true
    this.publish = true
  }

  private emit(name: string, payload: unknown, sessionId: string, retainedOutput?: () => string) {
    if (!this.publish) return
    if (this.active) this.run.onEvent?.(name, payload, retainedOutput)
    else this.run.onSubagentEvent?.(name, payload, sessionId)
  }

  private backgroundReceipt(id: string, sessionId: string, removed = false) {
    const item = this.backgroundItems.get(id)!
    const terminal = item.terminalId === undefined ? undefined : this.terminals.get(item.terminalId)
    const tool = item.toolCallId === undefined ? undefined : this.tools.get(item.toolCallId)
    const status = terminal?.exited
      ? terminal.failed
        ? 'failed'
        : 'completed'
      : tool?.status === 'completed' || tool?.status === 'failed' || tool?.status === 'cancelled'
        ? tool.status
        : removed
          ? 'completed'
          : 'running'
    this.run.onSubagentEvent?.(
      'dovo/acp/background',
      {
        id,
        title:
          tool?.title ?? (item.terminalId === undefined ? 'ACP background work' : 'Agent terminal'),
        status,
        output: terminal
          ? tail(terminal.text, 64000)
          : tool
            ? status === 'running' && !removed && this.toolPreviews.has(tool.toolCallId)
              ? this.toolPreviews.get(tool.toolCallId)
              : tail(toolContentText(tool.content), 64000)
            : undefined,
      },
      sessionId,
    )
  }

  private receipt(update: ToolCallUpdate, sessionId: string, retainedOutput?: () => string) {
    const id = `acp-tool:${update.toolCallId}`
    if (this.backgroundItems.has(id)) {
      this.backgroundReceipt(id, sessionId)
      return
    }
    const payload = { sessionId, update: { ...update, sessionUpdate: 'tool_call_update' } }
    if (this.active) this.emit('tool_call_update', payload, sessionId, retainedOutput)
    else if (this.publish) this.run.onSubagentEvent?.('dovo/acp/tool', payload, sessionId)
  }

  tool(update: ToolCallUpdate, sessionId: string) {
    const previous = this.tools.get(update.toolCallId)
    const next = { ...previous, ...update, _meta: metadata(previous?._meta, update._meta) }
    this.tools.set(update.toolCallId, next)
    if (!previous && this.active) this.run.onTextBoundary?.()
    // A status/metadata patch during streaming must not resend every preceding chunk.
    if (
      this.toolPreviews.has(update.toolCallId) &&
      update.content === undefined &&
      next.status !== 'completed' &&
      next.status !== 'failed' &&
      next.status !== 'cancelled'
    ) {
      this.receipt(
        {
          ...update,
          title: next.title,
          kind: next.kind,
          status: next.status,
          content: textContent(this.toolPreviews.get(update.toolCallId)!),
        },
        sessionId,
        retainToolOutput(next),
      )
    } else {
      this.toolPreviews.delete(update.toolCallId)
      this.receipt(next, sessionId)
    }
    if (next.title && this.active && !this.backgroundItems.has(`acp-tool:${update.toolCallId}`))
      this.run.onActivity(next.title)
  }

  private terminalReceipt(id: string, text: string, sessionId: string, fullOutput?: string) {
    const backgroundId = `acp-terminal:${id}`
    if (this.backgroundItems.has(backgroundId)) {
      this.backgroundReceipt(backgroundId, sessionId)
      return
    }
    const terminal = this.terminals.get(id)!
    this.receipt(
      {
        toolCallId: `acp-terminal:${id}`,
        title: 'Agent terminal',
        kind: 'execute',
        status: terminal.exited ? (terminal.failed ? 'failed' : 'completed') : 'in_progress',
        content: textContent(text),
      },
      sessionId,
      fullOutput === undefined ? undefined : () => fullOutput,
    )
  }

  // Keep one complete receipt when a turn ends without an explicit closing update.
  flush(sessionId: string) {
    for (const id of this.toolPreviews.keys()) this.receipt(this.tools.get(id)!, sessionId)
    for (const id of this.streamedTerminals)
      this.terminalReceipt(id, this.terminals.get(id)!.text, sessionId)
    this.toolPreviews.clear()
    this.streamedTerminals.clear()
  }

  accept(params: UpdateSessionNotification, active = true, publish = true) {
    this.active = active
    this.publish = publish
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
      publish &&
      (SessionUpdate.isAgentMessage(update) || SessionUpdate.isAgentMessageChunk(update))
    ) {
      const messages = active ? this.messages : this.sessionMessages
      if (!active && this.messages.has(update.messageId)) return
      const exists = messages.has(update.messageId)
      const previous = messages.get(update.messageId) ?? ''
      const text = SessionUpdate.isAgentMessageChunk(update)
        ? previous + (ContentBlock.isText(update.content) ? update.content.text : '')
        : update.content === undefined
          ? previous
          : (update.content ?? [])
              .filter(ContentBlock.isText)
              .map((item) => item.text)
              .join('')
      messages.set(update.messageId, text)
      if (!active) {
        if (text !== previous)
          this.run.onSubagentEvent?.(
            'dovo/acp/message',
            { id: update.messageId, text },
            params.sessionId,
          )
        return
      }
      // Normal tail chunks do not rebuild or scan the whole transcript. Earlier-message
      // patches still need the complete projection, in original insertion order.
      const append =
        !exists ||
        (this.lastMessageId === update.messageId &&
          (SessionUpdate.isAgentMessageChunk(update) || text.startsWith(previous)))
      if (append) {
        const delta = exists ? text.slice(previous.length) : text
        if (delta) this.run.onText(delta)
        this.emitted += delta
      } else {
        const output = [...this.messages.values()].join('')
        if (output.startsWith(this.emitted)) this.run.onText(output.slice(this.emitted.length))
        else if (this.run.onTextReplace) this.run.onTextReplace(output, this.emitted.length)
        else throw new Error('ACP v2 message replacement requires text replacement support')
        this.emitted = output
      }
      if (!exists) this.lastMessageId = update.messageId
    }
    if (
      active &&
      (SessionUpdate.isAgentThought(update) || SessionUpdate.isAgentThoughtChunk(update))
    )
      this.emit('acp/v2/reasoning', params, params.sessionId)
    if (SessionUpdate.isToolCallUpdate(update)) this.tool(update, params.sessionId)
    if (SessionUpdate.isToolCallContentChunk(update)) {
      const id = update.toolCallId
      const previous = this.tools.get(id)
      if (!previous && active) this.run.onTextBoundary?.()
      const tool = previous ?? { toolCallId: id }
      // Detach the retained array from the last receipt before appending in place.
      let preview = this.toolPreviews.get(id)
      if (preview === undefined) {
        tool.content = [...(tool.content ?? [])]
        preview = tail(toolContentText(tool.content))
        this.tools.set(id, tool)
      }
      tool.content!.push(update.content)
      const chunk = toolContentText(update.content)
      if (chunk) preview = tail(preview ? preview + '\n' + tail(chunk) : tail(chunk))
      this.toolPreviews.set(id, preview)
      this.receipt(
        {
          toolCallId: id,
          title: tool.title,
          kind: tool.kind,
          status: tool.status,
          content: chunk ? textContent(preview) : [update.content],
        },
        params.sessionId,
        retainToolOutput(tool),
      )
    }
    if (publish && SessionUpdate.isPlanUpdate(update) && PlanUpdateContent.isItems(update.plan)) {
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
      const first = !terminal
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
      if (SessionUpdate.isTerminalOutputChunk(update)) {
        terminal.text += terminal.decoder.decode(Buffer.from(update.data, 'base64'), {
          stream: true,
        })
      }
      const wasExited = terminal.exited
      const wasFailed = terminal.failed
      if (SessionUpdate.isTerminalUpdate(update) && update.exitStatus !== undefined) {
        terminal.exited = !!update.exitStatus
        terminal.failed =
          !!update.exitStatus &&
          ((update.exitStatus.exitCode != null && update.exitStatus.exitCode !== 0) ||
            !!update.exitStatus.signal)
        if (terminal.exited) terminal.text += terminal.decoder.decode()
      }
      terminal.text = tail(terminal.text, 262144)
      if (SessionUpdate.isTerminalOutputChunk(update)) {
        this.streamedTerminals.add(update.terminalId)
        this.terminalReceipt(
          update.terminalId,
          tail(terminal.text),
          params.sessionId,
          terminal.text,
        )
      } else if (
        first ||
        update.output !== undefined ||
        terminal.exited !== wasExited ||
        terminal.failed !== wasFailed
      ) {
        this.streamedTerminals.delete(update.terminalId)
        this.terminalReceipt(update.terminalId, terminal.text, params.sessionId)
      }
    }
    if (SessionUpdate.isUsageUpdate(update)) this.emit('usage_update', params, params.sessionId)
    if (SessionUpdate.isStateUpdate(update)) {
      if (Array.isArray(update.background)) {
        const next = new Map(
          update.background.map((item, index) =>
            BackgroundWork.isTerminal(item)
              ? [`acp-terminal:${item.terminalId}`, { terminalId: item.terminalId }]
              : BackgroundWork.isToolCall(item)
                ? [`acp-tool:${item.toolCallId}`, { toolCallId: item.toolCallId }]
                : [`acp-background:${index}`, {}],
          ),
        )
        for (const id of this.backgroundItems.keys())
          if (!next.has(id)) this.backgroundReceipt(id, params.sessionId, true)
        const previous = this.backgroundItems
        this.backgroundItems = next
        for (const id of next.keys())
          if (!previous.has(id)) this.backgroundReceipt(id, params.sessionId)
      }
      if (active && (StateUpdate.isRunning(update) || StateUpdate.isRequiresAction(update)))
        this.foregroundStarted = true
      if (StateUpdate.isIdle(update)) this.flush(params.sessionId)
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
