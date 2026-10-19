export type DeletionProgress = { verified: boolean; verify: () => void }
export type DeleteIdentity = (id: string, progress: DeletionProgress) => Promise<void>

/** Backend-only credentials. Never accept the identity or organization from an app request. */
export function identityDeletion(options: {
  issuer: string
  organization: string
  clientId: string
  clientSecret: string
}) {
  if (
    !options.organization ||
    options.organization === 'built-in' ||
    !options.clientSecret ||
    !options.clientId
  )
    throw new Error('Invalid account deletion configuration')
  const origin = new URL(options.issuer)
  if (origin.protocol !== 'https:' || origin.username || origin.password)
    throw new Error('Account identity deletion requires an HTTPS identity service')
  const authorization =
    'Basic ' + Buffer.from(options.clientId + ':' + options.clientSecret).toString('base64')
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(new URL(path, origin), {
      ...init,
      redirect: 'error',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Identity deletion could not be completed. Retry deletion.')
    const result: unknown = await response.json()
    if (
      !result ||
      typeof result !== 'object' ||
      !('status' in result) ||
      result.status !== 'ok' ||
      !('data' in result)
    )
      throw new Error('Identity deletion could not be completed. Retry deletion.')
    return result.data
  }
  return async (id: string, progress: DeletionProgress) => {
    const lookup =
      '/api/get-user?' + new URLSearchParams({ owner: options.organization, userId: id })
    const getUser = async () => {
      const data = await request(lookup)
      if (data === null) return null
      if (
        !data ||
        typeof data !== 'object' ||
        !('owner' in data) ||
        typeof data.owner !== 'string' ||
        !('name' in data) ||
        typeof data.name !== 'string' ||
        !data.name ||
        !('id' in data) ||
        typeof data.id !== 'string' ||
        !('isAdmin' in data) ||
        typeof data.isAdmin !== 'boolean' ||
        ('isGlobalAdmin' in data && typeof data.isGlobalAdmin !== 'boolean')
      )
        throw new Error('Invalid identity deletion response')
      if (
        data.id !== id ||
        data.owner !== options.organization ||
        data.isAdmin ||
        ('isGlobalAdmin' in data && data.isGlobalAdmin)
      )
        throw new Error('This account requires administrator-assisted deletion')
      return data
    }
    const user = await getUser()
    // A lost response after successful deletion is safe to retry.
    if (!user) {
      if (progress.verified) return
      throw new Error('This account requires administrator-assisted deletion')
    }
    progress.verify()
    const remove = async () => {
      const result = await request(
        '/api/delete-user?' + new URLSearchParams({ id: user.owner + '/' + user.name }),
        { method: 'POST', body: JSON.stringify({ owner: user.owner, name: user.name }) },
      )
      if (result !== 'Affected')
        throw new Error('Identity deletion was not confirmed. Retry deletion.')
    }
    await remove()
    const remaining = await getUser()
    if (!remaining) return
    // Casdoor soft-deletes first; deleting an already soft-deleted identity purges its record.
    if (!('isDeleted' in remaining) || remaining.isDeleted !== true || remaining.name !== user.name)
      throw new Error('Identity deletion was not confirmed. Retry deletion.')
    await remove()
    if (await getUser()) throw new Error('Identity deletion was not confirmed. Retry deletion.')
  }
}
