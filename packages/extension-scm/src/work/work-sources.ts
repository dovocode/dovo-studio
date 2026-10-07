import { assignRemoteSources, runtimeComputerName } from '@dovo/protocol'
import { useMemo, useRef } from 'react'
import {
  useRepositorySources,
  useWorkspace,
  type RepositorySource,
  type JiraSource,
  type RuntimeProfile,
} from '@dovo/studio-core'
export type WorkSource = Omit<RepositorySource, 'repository'> & {
  name: string
  repository?: RepositorySource['repository']
  jira?: JiraSource
  projectLinks?: Record<string, string>
  input:
    | {
        repositoryId: string
      }
    | {
        jiraSourceId: string
      }
}
export const jiraSourceKey = (runtimeId: string, sourceId: string) =>
  JSON.stringify([runtimeId, 'jira', sourceId])
/** The same Jira project on several computers is one source; its reader can change. */
export const jiraRemoteKey = (jira: Pick<JiraSource, 'site' | 'project'>) =>
  JSON.stringify(['jira', new URL(jira.site).origin, jira.project])

/** Issue trackers and code repositories have separate identities and lifecycles. Like pull
 * requests, each remote and each Jira project is read through one computer: this computer when
 * it has the source, otherwise the least loaded connected computer, kept until it disconnects. */
export function useIssueSources(includeJira: boolean): WorkSource[] {
  const allRepositories = useRepositorySources()
  const owners = useRef(new Map<string, string>())
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
    includeJira
      ? runtimes.flatMap((entry) => {
          const active = entry.profile.id === activeRuntimeId
          const saved = active ? workspace : entry.snapshot?.workspace
          const sources = saved?.jiraSources ?? []
          const runtimeName = runtimeComputerName(entry)
          return sources.map((jira) => ({
            profile: entry.profile,
            jira,
            projectLinks: Object.fromEntries(
              (saved?.jiraIssueLinks ?? [])
                .filter((link) => link.sourceId === jira.id)
                .flatMap((link) => {
                  const repository = saved?.repositories.find(
                    (item) => item.id === link.repositoryId,
                  )
                  return repository ? [[link.issueId, repository.name]] : []
                }),
            ),
            runtimeName,
            connected: active ? connected : entry.connected,
          }))
        })
      : [],
  )
  return useMemo(() => {
    const jira: {
      profile: RuntimeProfile
      jira: JiraSource
      projectLinks: Record<string, string>
      runtimeName: string
      connected: boolean
    }[] = JSON.parse(descriptors)
    const repositories = assignRemoteSources(allRepositories, {
      previous: owners.current,
      preferredRuntimeId: activeRuntimeId,
    })
    const trackers = assignRemoteSources(
      jira.map((entry) => ({
        ...entry,
        key: jiraSourceKey(entry.profile.id, entry.jira.id),
        runtimeId: entry.profile.id,
      })),
      {
        previous: owners.current,
        preferredRuntimeId: activeRuntimeId,
        remote: (entry) => jiraRemoteKey(entry.jira),
      },
    )
    owners.current = new Map([...repositories.owners, ...trackers.owners])
    return [
      ...repositories.selected.map((source) => ({
        ...source,
        name: source.repository.name,
        input: {
          repositoryId: source.repository.id,
        },
      })),
      ...trackers.selected.map(({ profile, jira, projectLinks, runtimeName, connected }) => ({
        key: jiraSourceKey(profile.id, jira.id),
        runtimeId: profile.id,
        runtimeName,
        profile,
        jira,
        projectLinks,
        name: jira.name || `Jira · ${jira.project}`,
        connected,
        input: {
          jiraSourceId: jira.id,
        },
        scope: JSON.stringify([profile.id, profile.connection, jira]),
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
      })),
    ]
  }, [
    descriptors,
    allRepositories,
    activeRuntimeId,
    readRuntime,
    readRuntimeEffect,
    runtimeReadCache,
  ])
}
