/** Keep catalogue labels, with compact OpenAI names; IDs are never changed. */
export function modelDisplayName(id: string, name?: string) {
  if (name && name !== id)
    return name
      .replace(/^(?:GPT[- ]?)(?=\d)/i, '')
      .replace(/^(\d[^ ]*)-(Sol|Astra|Luna)\b/i, '$1 $2')
  const claude = id.replace(
    /(^|\/)claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d{8})?$/i,
    (_match, prefix: string, family: string, major: string, minor: string) =>
      `${prefix}Claude ${family[0].toUpperCase()}${family.slice(1)} ${major}.${minor}`,
  )
  return claude.replace(
    /(^|\/)gpt-(\d[^/]+)/i,
    (_match, prefix: string, suffix: string) =>
      `${prefix}${suffix.replace(/-([a-z])/g, (_match, letter: string) => ` ${letter.toUpperCase()}`)}`,
  )
}
