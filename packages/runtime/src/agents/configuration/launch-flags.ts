/** Claude's SDK accepts named flags; each saved argument is --name or --name=value. */
export function claudeLaunchFlags(args: readonly string[] = []): Record<string, string | null> {
  const flags: Record<string, string | null> = {}
  for (const arg of args) {
    const match = /^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.*))?$/.exec(arg)
    if (!match) throw new Error('Claude flags must use --name or --name=value, one per line')
    flags[match[1]] = match[2] ?? null
  }
  return flags
}
