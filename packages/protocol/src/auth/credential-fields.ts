/** Keep saved credentials opaque; editors never render their stored references. */
export type CredentialField = { name: string; value: string; saved?: string; replacing: boolean }
export const credentialFields = (values: Record<string, string>): CredentialField[] =>
  Object.entries(values).map(([name, saved]) => ({ name, saved, value: '', replacing: false }))
export function credentialValues(fields: readonly CredentialField[]): Record<string, string> {
  const entries: [string, string][] = []
  const names = new Set<string>()
  for (const field of fields) {
    const name = field.name.trim()
    if (!name) throw new Error('Enter a name for each credential, or remove the empty row.')
    if (names.has(name)) throw new Error('Each credential must have a unique name.')
    names.add(name)
    entries.push([name, !field.replacing && field.saved !== undefined ? field.saved : field.value])
  }
  return Object.fromEntries(entries)
}
