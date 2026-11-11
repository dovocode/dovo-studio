import { useMemo, useRef } from 'react'
import { Schema } from 'effect'
import {
  forgeSourceIdentitySchema,
  RuntimeRequestError,
  type ForgeSourceIdentity,
} from '@dovo/protocol'
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
  const pin = useRef<{ scope: string; lookup?: Promise<ForgeSourceIdentity | undefined> }>({
    scope,
  })
  if (pin.current.scope !== scope) pin.current = { scope }
  return useMemo(() => {
    // One lookup pins the account for this scope; concurrent first reads share it. The runtime
    // checks the pinned account on every later read, so those need no lookup of their own.
    // Transport callbacks may change without a source change (for example a computer rename).
    // Keep the pin while using the latest callback for the actual read.
    const pinned = pin.current
    const discover = () =>
      request('/api/scm/source/identity', target, forgeSourceIdentitySchema).catch(
        (error: unknown) => {
          if (error instanceof RuntimeRequestError && [404, 405].includes(error.status ?? 0))
            return undefined
          throw error
        },
      )
    return async <T extends Schema.Codec<unknown, unknown>>(
      path: string,
      input: Record<string, unknown>,
      schema: T,
    ): Promise<T['Type']> => {
      const lookup = (pinned.lookup ??= discover().then(
        (identity) => {
          // Older runtimes have no identity discovery; ask again so an upgrade is noticed.
          if (!identity) pinned.lookup = undefined
          return identity
        },
        (error: unknown) => {
          pinned.lookup = undefined
          throw error
        },
      ))
      const identity = await lookup
      return request(
        path,
        {
          ...input,
          expectedReaderIdentity: identity?.readerIdentity,
          expectedDestination: identity?.destination,
        },
        schema,
      )
    }
  }, [scope, request])
}
