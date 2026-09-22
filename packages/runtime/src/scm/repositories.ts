import { randomUUID } from 'node:crypto'
import { addRepositorySchema } from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError, errorMessage } from '../errors.js'
import { repositoryPath } from './paths.js'

export async function addRepository(s: Services, value: unknown) {
  const input = addRepositorySchema.parse(value)
  const checkout = await (async () => {
    if (input.source === 'forge') {
      const parent = await repositoryPath(input.directory).catch((error: unknown) => {
        throw new HttpError(
          400,
          `Choose an existing clone parent folder on the runtime host. ${errorMessage(error)}`,
        )
      })
      const repo = await s.pulls
        .adapter(input.forge.connectionId, input.forge.repository, parent)
        .repository()
      const connection = s.forges.get(input.forge.connectionId)
      return s.git.cloneRemote(
        repo,
        parent,
        connection.provider === 'github' && !connection.cliProfile
          ? undefined
          : await s.forges.gitAuthorization(connection.id, repo.cloneUrl, parent),
        connection.provider === 'github' && !connection.cliProfile,
      )
    }
    if (input.source === 'github') return s.git.cloneGithub(input.repository, input.directory)
    try {
      return await s.git.inspect(input.path)
    } catch (error) {
      throw new HttpError(
        400,
        `Choose an existing Git repository on the runtime host. ${errorMessage(error)}`,
      )
    }
  })()
  // Checking after inspection also deduplicates concurrent registrations of the same checkout.
  const existing = s.store.get().repositories.find((repo) => repo.path === checkout.path)
  if (existing) return existing
  const repository = {
    id: randomUUID(),
    name: input.name,
    ...checkout,
    ...(input.source === 'forge'
      ? { forge: { ...input.forge, revision: s.forges.get(input.forge.connectionId).revision } }
      : {}),
  }
  s.store.update((workspace) => ({
    ...workspace,
    repositories: [...workspace.repositories, repository],
  }))
  return repository
}
