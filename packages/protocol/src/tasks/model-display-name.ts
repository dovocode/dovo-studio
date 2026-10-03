/** Catalogue names are authoritative; only prettify recognizable raw model identifiers. */
export function modelDisplayName(id: string, name?: string) {
  if (name && name !== id) return name
  const claude = id.replace(
    /(^|\/)claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d{8})?$/i,
    (_match, prefix: string, family: string, major: string, minor: string) =>
      `${prefix}Claude ${family[0].toUpperCase()}${family.slice(1)} ${major}.${minor}`,
  )
  return claude.replace(
    /(^|\/)gpt-(\d[^/]+)/i,
    (_match, prefix: string, suffix: string) =>
      `${prefix}GPT-${suffix.replace(/(^|-)([a-z])/g, (_match, separator: string, letter: string) => `${separator}${letter.toUpperCase()}`)}`,
  )
}
