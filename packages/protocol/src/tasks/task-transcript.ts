import type { Task } from '../workspace.js'

/** The conversation as Markdown, for copying into notes, an issue or a chat. Only sent
 * messages are included; queued input and empty replies are left out. */
export function taskTranscript(task: Pick<Task, 'title' | 'messages'>) {
  const sections = task.messages.flatMap((message) => {
    const text = message.text.trim()
    const files = message.attachments?.map((file) => file.name) ?? []
    if (!text && !files.length) return []
    const speaker = message.role === 'user' ? '**You**' : '**Agent**'
    const attached = files.length ? `\n\n_Attached: ${files.join(', ')}_` : ''
    return [`${speaker}\n\n${text}${attached}`.trim()]
  })
  return [`# ${task.title}`, ...sections].join('\n\n---\n\n') + '\n'
}
