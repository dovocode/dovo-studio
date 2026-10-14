import { useMemo } from 'react'
import { Schema } from 'effect'
import { forgeSourceIdentitySchema, RuntimeRequestError } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'

/** Forms and embedded queries stay on their scoped computer and pin the verified
 * account across all pages. Identity discovery itself is a safe read. */
export function useVerifiedRead(target: {
  repositoryId?: string
  jiraSourceId?: string
  connectionId?: string
}) {
  const { request, activeRuntimeId, connection, workspace } = useWorkspace()
  const repository = workspace.repositories.find((entry) => entry.id === target.repositoryId)
  const jira = workspace.jiraSources?.find((entry) => entry.id === target.jiraSourceId)
  const scope = JSON.stringify([
    activeRuntimeId,
    connection,
    target,
    repository?.forge,
    jira ? [jira.id, jira.site, jira.project] : undefined,
  ])
  return useMemo(() => {
    let readerIdentity: string | undefined
    return async <T extends Schema.Codec<unknown, unknown>>(
      path: string,
      input: Record<string, unknown>,
      schema: T,
    ): Promise<T['Type']> => {
      let identity: string | undefined
      try {
        identity = (await request('/api/scm/source/identity', target, forgeSourceIdentitySchema))
          .readerIdentity
      } catch (error) {
        if (!(error instanceof RuntimeRequestError && [404, 405].includes(error.status ?? 0)))
          throw error
      }
      if (readerIdentity && readerIdentity !== identity)
        throw new RuntimeRequestError({
          kind: 'request',
          status: 409,
          message:
            'This source account changed. Refresh the source and choose its account explicitly.',
        })
      readerIdentity = identity
      return request(path, { ...input, expectedReaderIdentity: identity }, schema)
    }
  }, [scope, request])
}
