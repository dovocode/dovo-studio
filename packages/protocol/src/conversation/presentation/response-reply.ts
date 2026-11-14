/** A reference keeps the prompt small. The full response remains in its source thread. */
export function responseReply(message: { id: string; text: string }) {
  const text = message.text.trim()
  const quote = text.slice(0, 500)
  return `[Reply to assistant message ${JSON.stringify(message.id)}. Use conversation_read with this messageId for more context.]\n${quote
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}${text.length > 500 ? '\n> …' : ''}\n\n`
}
