/** Keep only completed paragraphs and fenced code blocks while a reply is streaming. */
export function completedStreamingText(text: string) {
  let completed = 0
  let offset = 0
  let fence: { character: string; length: number } | undefined
  for (const line of text.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line)
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length }
      else if (
        marker[1][0] === fence.character &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = undefined
        completed = offset + line.length
      }
    } else if (!fence && !line.trim()) completed = offset + line.length
    offset += line.length
  }
  return text.slice(0, completed)
}
