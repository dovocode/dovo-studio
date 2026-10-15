import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/** Preserve root-owned foreground agents before priority-now cancels active tools. */
export class ClaudeBackgroundTasks {
  private rootTools = new Set<string>()
  private background = new Set<string>()
  private tasks = new Map<string, { toolUseId: string; depth?: number; background: boolean }>()
  private moves = new Map<string, Promise<void>>()

  accept(message: SDKMessage) {
    if (message.type === 'assistant' && message.parent_tool_use_id == null)
      for (const block of message.message.content)
        if (block.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task'))
          this.rootTools.add(block.id)
    if (message.type !== 'system') return
    if (message.subtype === 'task_started') {
      this.tasks.delete(message.task_id)
      if (
        message.tool_use_id &&
        (message.task_type === 'local_agent' || message.subagent_type) &&
        !message.ambient &&
        !message.skip_transcript
      )
        this.tasks.set(message.task_id, {
          toolUseId: message.tool_use_id,
          depth: message.spawn_depth,
          background: message.is_backgrounded ?? this.background.has(message.task_id),
        })
    }
    if (message.subtype === 'task_notification') this.tasks.delete(message.task_id)
    if (message.subtype === 'task_updated') {
      const task = this.tasks.get(message.task_id)
      if (task && message.patch.is_backgrounded !== undefined)
        task.background = message.patch.is_backgrounded
      if (message.patch.status && !['pending', 'running'].includes(message.patch.status))
        this.tasks.delete(message.task_id)
    }
    if (message.subtype === 'background_tasks_changed') {
      this.background = new Set(message.tasks.map((task) => task.task_id))
      for (const task of message.tasks) {
        const tracked = this.tasks.get(task.task_id)
        if (tracked) tracked.background = true
      }
    }
  }

  async preserve(query: Query, signal: AbortSignal) {
    const moves: Promise<void>[] = []
    for (const [taskId, task] of this.tasks) {
      if (
        task.background ||
        (task.depth !== undefined ? task.depth !== 1 : !this.rootTools.has(task.toolUseId))
      )
        continue
      let move = this.moves.get(task.toolUseId)
      if (!move) {
        move = (async () => {
          try {
            if ((await query.backgroundTasks(task.toolUseId)) && this.tasks.get(taskId) === task)
              task.background = true
          } catch (error) {
            console.warn('Could not background Claude agent before steering:', taskId, error)
          }
        })()
        this.moves.set(task.toolUseId, move)
        void move.finally(() => this.moves.delete(task.toolUseId))
      }
      moves.push(move)
    }
    if (!moves.length) return
    // The SDK supplies no deadline. A refused or stalled move must not prevent steering.
    let timeout: ReturnType<typeof setTimeout> | undefined
    let abort = () => {}
    try {
      await Promise.race([
        Promise.all(moves),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 5_000)
          abort = resolve
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) resolve()
        }),
      ])
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  }
}
