/** A reference keeps the prompt small. The full response remains in its source thread. */
export function responseReply(message: { id: string; text: string }) {
  const text = message.text.trim()
  const quote = text.slice(0, 500)
  return responseSelectionReply(message.id, quote + (text.length > 500 ? '\n…' : ''))
}

export function responseSelectionReply(messageId: string, selection: string, comment = '') {
  const note = comment.trim()
  return `[Reply to assistant message ${JSON.stringify(messageId)}. Use conversation_read with this messageId for more context.]\n${selection
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}\n\n${note ? note + '\n\n' : ''}`
}
