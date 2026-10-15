import {
  decodeResult,
  nativeAgentWorking,
  type Agent,
  type AgentHook,
  type Subagent,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { toolEvent } from './tool-event.js'
import { updateSubagents } from './subagents.js'
import { completedCompaction } from '../tasks/compaction.js'

const record = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
const object = (value: unknown) => decodeResult(record, value).data ?? {}
const text = (value: unknown) => (typeof value === 'string' ? value : '')
export type HookTool = {
  id: string
  name: string
  kind: 'command' | 'file' | 'search' | 'web' | 'tool'
  status: string
  input?: unknown
  output?: unknown
}
export type HookEventData = {
  tool?: HookTool
  subagent?: Subagent
  prompt?: string
  resumed?: boolean
  trigger?: 'manual' | 'auto'
  permission?: { title: string; detail: string; decision?: string }
  error?: string
}
export type LifecycleEvent = { event: AgentHook['event']; data: HookEventData }

function kind(name: string): HookTool['kind'] {
  if (/bash|shell|command|exec|terminal|userShell/i.test(name)) return 'command'
  if (/web|fetch|browse/i.test(name)) return 'web'
  if (/search|grep|glob/i.test(name)) return 'search'
  if (/read|write|edit|patch|file/i.test(name)) return 'file'
  return 'tool'
}

/** Shared lifecycle, independent of provider wire formats. Progress updates do not re-run hooks. */
export class HookEvents {
  private tools = new Map<string, HookTool>()
  private phases = new Map<string, AgentHook['event']>()
  private subagents: Subagent[] = []
  constructor(
    private provider: Agent['provider'],
    public sessionId?: string,
  ) {}
  accept(name: string, payload: unknown): LifecycleEvent[] {
    const events: LifecycleEvent[] = []
    const data = object(payload)
    const accept = (tool: HookTool) => {
      if (!tool.id) return
      const previous = this.tools.get(tool.id)
      const current = {
        ...tool,
        name: tool.name || previous?.name || 'Tool',
        kind: previous?.kind ?? tool.kind,
        input: tool.input ?? previous?.input,
      }
      const event = /failed|error|cancelled|interrupted/i.test(tool.status)
        ? 'tool-error'
        : /completed|success|succeeded|done/i.test(tool.status)
          ? 'tool-complete'
          : 'tool-start'
      const phase = this.phases.get(tool.id)
      // Terminal results are emitted once; progress may refine inputs before completion.
      if (phase && phase !== 'tool-start') return
      if (event === 'tool-start') this.tools.set(tool.id, current)
      else this.tools.delete(tool.id)
      if (phase === event) return
      this.phases.set(tool.id, event)
      events.push({ event, data: { tool: current } })
    }
    if (this.provider === 'claude') {
      const blocks = object(data.message).content
      for (const entry of Array.isArray(blocks) ? blocks : []) {
        const block = object(entry)
        if (block.type === 'tool_use')
          accept({
            id: text(block.id),
            name: text(block.name),
            kind: kind(text(block.name)),
            input: block.input,
            status: 'running',
          })
        if (block.type === 'tool_result')
          accept({
            id: text(block.tool_use_id),
            name: '',
            kind: 'tool',
            output: block.content,
            status: block.is_error ? 'failed' : 'completed',
          })
      }
    } else {
      const tool = toolEvent(this.provider, name, payload)
      if (tool) {
        const item = object(data.item),
          part = object(object(data.properties).part),
          update = object(data.update),
          state = object(part.state)
        const entry = object(data.entry),
          detail = object(entry.detail)
        const nativeName =
          text(item.tool) ||
          text(data.name) ||
          text(data.toolName) ||
          text(part.tool) ||
          text(detail.toolName) ||
          text(item.type) ||
          text(update.title)
        accept({
          id: tool.toolId,
          name: nativeName,
          kind: kind(text(update.kind) || text(detail.kind) || nativeName),
          status:
            (typeof item.exitCode === 'number' && item.exitCode !== 0) || item.error
              ? 'failed'
              : tool.status,
          input:
            item.arguments ??
            item.args ??
            data.arguments ??
            data.args ??
            data.input ??
            state.input ??
            update.rawInput ??
            detail.arguments ??
            detail.input ??
            object(detail.effect).input ??
            item.command ??
            item.commandText,
          output:
            item.result ??
            item.output ??
            item.aggregatedOutput ??
            data.result ??
            data.output ??
            state.output ??
            state.error ??
            update.rawOutput ??
            update.content ??
            detail.output ??
            object(entry.state).outputText ??
            object(entry.state).error,
        })
      }
    }
    if (
      (this.provider === 'codex' &&
        name === 'item/started' &&
        object(data.item).type === 'contextCompaction') ||
      (this.provider === 'claude' &&
        name === 'system' &&
        data.subtype === 'status' &&
        data.status === 'compacting') ||
      (this.provider === 'opencode' && name === 'session.compaction.started')
    )
      events.push({ event: 'before-compaction', data: { trigger: 'auto' } })
    const trigger = completedCompaction(this.provider, name, payload)
    if (trigger) events.push({ event: 'after-compaction', data: { trigger } })
    const next = updateSubagents(
      this.subagents,
      this.provider,
      payload,
      new Date().toISOString(),
      name,
      this.sessionId,
    )
    for (const subagent of next) {
      const previous = this.subagents.find((item) => item.id === subagent.id)
      if (nativeAgentWorking(subagent) && (!previous || !nativeAgentWorking(previous)))
        events.push({ event: 'subagent-start', data: { subagent } })
      else if (previous && nativeAgentWorking(previous) && !nativeAgentWorking(subagent))
        events.push({ event: 'subagent-stop', data: { subagent } })
    }
    this.subagents = next
    return events
  }
}
