import type { Task } from '@dovo/studio-core'

export function searchThread(messages: Task['messages'], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  return messages.flatMap((message) => {
    const offset = message.text.toLocaleLowerCase().indexOf(needle)
    if (offset < 0) return []
    const start = Math.max(0, offset - 60)
    return [
      {
        id: message.id,
        role: message.role,
        preview: `${start ? '…' : ''}${message.text.slice(start, offset + needle.length + 120)}`,
      },
    ]
  })
}
