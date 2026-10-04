import { runtimeComputerName } from '@dovo/protocol'
import { useMemo } from 'react'
import type { Repository, RuntimeProfile } from '@dovo/protocol'
import { useWorkspace } from './provider'
export const repositorySourceKey = (runtimeId: string, repositoryId: string) =>
  JSON.stringify([runtimeId, repositoryId])
export function useRepositorySources() {
  const {
    workspace,
    activeRuntimeId,
    connected,
    runtimes,
    readRuntime,
    readRuntimeEffect,
    runtimeReadCache,
  } = useWorkspace()
  const descriptors = JSON.stringify(
    runtimes.flatMap((entry) => {
      const active = entry.profile.id === activeRuntimeId
      const repositories = active
        ? workspace.repositories
        : (entry.snapshot?.workspace.repositories ?? [])
      const runtimeName = runtimeComputerName(entry)
      return repositories
        .filter((repository) => !repository.kind)
        .map((repository) => ({
          profile: entry.profile,
          repository,
          runtimeName,
          connected: active ? connected : entry.connected,
        }))
    }),
  )
  return useMemo(() => {
    const sources: {
      profile: RuntimeProfile
      repository: Repository
      runtimeName: string
      connected: boolean
    }[] = JSON.parse(descriptors)
    return sources.map(({ profile, repository, runtimeName, connected }) => ({
      key: repositorySourceKey(profile.id, repository.id),
      runtimeId: profile.id,
      runtimeName,
      profile,
      repository,
      connected,
      scope: JSON.stringify([
        profile.id,
        profile.connection,
        repository.id,
        repository.path,
        repository.forge,
        repository.jira,
      ]),
      readCache: runtimeReadCache(profile),
      requestEffect: <T extends Parameters<typeof readRuntimeEffect>[3]>(
        path: string,
        input: unknown,
        schema: T,
      ) => readRuntimeEffect(profile, path, input, schema),
      request: <T extends Parameters<typeof readRuntime>[3]>(
        path: string,
        input: unknown,
        schema: T,
      ) => readRuntime(profile, path, input, schema),
    }))
  }, [descriptors, readRuntime, readRuntimeEffect, runtimeReadCache])
}
export type RepositorySource = ReturnType<typeof useRepositorySources>[number]
