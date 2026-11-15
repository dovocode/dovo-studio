import { Schema } from 'effect'
import type { Task } from '../../workspace.js'

export const turnAnnouncementsSchema = Schema.Literals(['off', 'status', 'messages', 'steps'])
export type TurnAnnouncements = Schema.Schema.Type<typeof turnAnnouncementsSchema>
type Thread = Pick<Task, 'status' | 'messages' | 'turns'>
type Step = { id: string; turnId?: string; status: string; summary: string }

/** Announce only new work in the open thread. Old pages and token deltas stay silent. */
export class TurnAnnouncementsTracker {
  private scope = ''
  private status = ''
  private since = Date.now()
  private messages = new Map<string, number>()
  private steps = new Set<string>()
  private mode: TurnAnnouncements = 'off'
  update(
    scope: string,
    task: Thread,
    steps: readonly Step[],
    mode: TurnAnnouncements,
    translate: (text: string) => string = (text) => text,
  ): string[] {
    const reset = this.scope !== scope || this.mode !== mode
    if (reset) {
      this.scope = scope
      this.mode = mode
      this.since = Date.now()
      this.messages.clear()
      this.steps.clear()
    }
    const result: string[] = []
    if (!reset && mode !== 'off' && this.status !== task.status) {
      const label =
        task.status === 'running'
          ? 'Agent is working.'
          : task.status === 'failed'
            ? 'Turn failed.'
            : task.status === 'cancelled'
              ? 'Turn stopped.'
              : task.status === 'review' || task.status === 'done'
                ? 'Turn finished.'
                : ''
      if (label) result.push(translate(label))
    }
    this.status = task.status
    if (mode === 'off' || mode === 'status') return result
    const turns = new Map(
      task.turns?.flatMap((turn) => [[turn.id, turn] as const, [turn.assistantId, turn] as const]),
    )
    for (const message of task.messages) {
      if (message.role !== 'assistant') continue
      const turn = turns.get(message.turnId ?? message.id)
      const eligible =
        !!turn &&
        (turn.status === 'running' ||
          Date.parse(turn.startedAt) >= this.since ||
          this.messages.has(message.id))
      const complete =
        turn && turn.status !== 'running'
          ? message.text.length
          : Math.max(0, ...(message.textBreaks ?? []))
      const previous = this.messages.get(message.id) ?? 0
      if (!reset && eligible && (mode === 'messages' || mode === 'steps') && complete > previous) {
        const text = message.text.slice(previous, complete).trim()
        if (text)
          result.push(
            text.length <= 1600
              ? text
              : `${text.slice(0, 1600)}. ${translate('Read the thread for the rest of this message.')}`,
          )
      }
      if (reset || eligible) this.messages.set(message.id, complete)
    }
    for (const step of steps) {
      const complete = ['completed', 'error', 'failed', 'cancelled'].includes(step.status)
      const turn = step.turnId ? turns.get(step.turnId) : undefined
      if (
        !reset &&
        mode === 'steps' &&
        complete &&
        !this.steps.has(step.id) &&
        turn &&
        (turn.status === 'running' || Date.parse(turn.startedAt) >= this.since)
      )
        result.push(`${step.summary.slice(0, 250)}. ${translate(step.status)}.`)
      if (complete) this.steps.add(step.id)
    }
    // Only retain identities for the loaded window, never the full conversation.
    const ids = new Set(task.messages.map((entry) => entry.id))
    for (const id of this.messages.keys()) if (!ids.has(id)) this.messages.delete(id)
    if (this.steps.size > 500) this.steps = new Set([...this.steps].slice(-250))
    return result
  }
}
