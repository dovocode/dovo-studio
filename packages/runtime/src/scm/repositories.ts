import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { decode, addRepositorySchema } from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import type { Services } from '../services.js'
import { HttpError, errorMessage, runtimeOperation, runtimeProgram } from '../errors.js'
import { repositoryPath } from './paths.js'
export function addRepositoryEffect(s: Services, value: unknown) {
  return runtimeProgram(
    Effect.gen(function* () {
      const input = decode(addRepositorySchema, value)
      const checkout = yield* Effect.gen(function* () {
        if (input.source === 'forge') {
          const parent = yield* runtimeOperation(() => repositoryPath(input.directory)).pipe(
            Effect.mapError(
              (error) =>
                new HttpError(
                  400,
                  `Choose an existing clone parent folder on the runtime host. ${errorMessage(error)}`,
                ),
            ),
          )
          const repo = yield* runtimeOperation(() =>
            s.pulls.adapter(input.forge.connectionId, input.forge.repository, parent).repository(),
          )
          const connection = s.forges.get(input.forge.connectionId)
          const defaultGithub = connection.provider === 'github' && !connection.cliProfile
          const authorization = defaultGithub
            ? undefined
            : yield* runtimeOperation(() =>
                s.forges.gitAuthorization(connection.id, repo.cloneUrl, parent),
              )
          return yield* runtimeOperation(() =>
            s.git.cloneRemote(repo, parent, authorization, defaultGithub),
          )
        }
        if (input.source === 'github')
          return yield* runtimeOperation(() => s.git.cloneGithub(input.repository, input.directory))
        return yield* runtimeOperation(() => s.git.inspect(input.path)).pipe(
          Effect.mapError(
            (error) =>
              new HttpError(
                400,
                `Choose an existing Git repository on the runtime host. ${errorMessage(error)}`,
              ),
          ),
        )
      })
      // Deduplicate only after inspection, including concurrent registration of the same checkout.
      const existing = s.store.get().repositories.find((repo) => repo.path === checkout.path)
      if (existing) return existing
      const repository = {
        id: randomUUID(),
        name: input.name,
        ...checkout,
        ...(input.source === 'forge'
          ? {
              forge: {
                ...input.forge,
                revision: s.forges.get(input.forge.connectionId).revision,
              },
            }
          : {}),
      }
      s.store.update((workspace) => ({
        ...workspace,
        repositories: [...workspace.repositories, repository],
      }))
      return repository
    }),
  ).pipe(Effect.uninterruptible)
}
export function addRepository(s: Services, value: unknown) {
  return runClientEffect(addRepositoryEffect(s, value))
}
