/** Explicit administrator mapping, never inferred from email, name or number of users. */
export function ownerMappings(value: unknown): Readonly<Record<string, string>> {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid auth owner mappings')
  const owners: Record<string, string> = {}
  const ids = new Set<string>()
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('githubId' in item) ||
      typeof item.githubId !== 'string' ||
      !/^[1-9][0-9]{0,19}$/.test(item.githubId) ||
      !('accountId' in item) ||
      typeof item.accountId !== 'string' ||
      !item.accountId ||
      item.accountId.length > 200 ||
      owners[item.githubId] ||
      ids.has(item.accountId)
    )
      throw new Error('Invalid or duplicate auth owner mapping')
    owners[item.githubId] = item.accountId
    ids.add(item.accountId)
  }
  return owners
}
