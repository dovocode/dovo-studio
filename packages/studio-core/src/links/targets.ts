import {
  forgePullTarget,
  gitRemoteIdentity,
  pullRepositoryIdentity,
  runtimeComputerName,
  type RuntimeOverview,
} from '@dovo/protocol'
export type LinkOrigin = { runtimeId?: string; repositoryId?: string; jiraSourceId?: string }
export type LinkTarget = {
  label: string
  runtimeId: string
  repositoryId?: string
  jiraSourceId?: string
} & (
  | {
      kind: 'pull'
      number: number
      url: string
      navigationUrl: string
      tab: 'overview' | 'changes' | 'checks'
      fragment: string
    }
  | { kind: 'issue' | 'pipeline'; repositoryId: string; itemId: string; url: string }
  | { kind: 'jira'; jiraSourceId: string; itemId: string; url: string }
)

function contextualChoices(choices: LinkTarget[], origin?: LinkOrigin) {
  const owner = choices.filter((choice) => choice.runtimeId === origin?.runtimeId)
  const source = owner.filter(
    (choice) =>
      (origin?.repositoryId && choice.repositoryId === origin.repositoryId) ||
      (origin?.jiraSourceId && choice.jiraSourceId === origin.jiraSourceId),
  )
  return source.length ? source : owner.length ? owner : choices
}

/** Configured repository identity is authoritative; clone URLs cannot override a forge binding. */
export function resolveLinkTargets(
  input: string,
  overviews: readonly RuntimeOverview[],
  origin?: LinkOrigin,
) {
  const repositories = overviews.flatMap((entry) =>
    (entry.snapshot?.workspace.repositories ?? [])
      .filter((repository) => !repository.kind)
      .map((repository) => ({ entry, repository, identity: pullRepositoryIdentity(repository) })),
  )
  const pull = forgePullTarget(
    input,
    repositories.map(({ identity }) => ({ identity })),
  )
  if (pull) {
    const choices = repositories
      .filter(({ identity }) => identity === pull.identity)
      .map(({ entry, repository }) => ({
        runtimeId: entry.profile.id,
        repositoryId: repository.id,
        label: `${repository.name} · ${runtimeComputerName(entry)}`,
        kind: 'pull' as const,
        ...pull,
      }))
    if (choices.length) return contextualChoices(choices, origin)
    // URL-only detail still belongs to the caller's computer. It chooses an account there.
    const owners = origin?.runtimeId
      ? overviews.filter((entry) => entry.profile.id === origin.runtimeId)
      : overviews
    return owners.map((entry) => ({
      runtimeId: entry.profile.id,
      label: runtimeComputerName(entry),
      kind: 'pull' as const,
      ...pull,
    }))
  }
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return []
    const issue = url.pathname.match(/^\/(.+?)\/(?:-\/)?issues\/([1-9]\d*)\/?$/)
    const run = url.pathname.match(
      /^\/(.+?)\/(?:actions\/runs|(?:-\/)?pipelines(?:\/results)?)\/([A-Za-z0-9%{}_-]+)(?:\/job\/[1-9]\d*)?\/?$/,
    )
    const azureIssue =
      url.hostname.toLowerCase() === 'dev.azure.com'
        ? url.pathname.match(/^\/([^/]+)\/([^/]+)\/_workitems\/edit\/([1-9]\d*)\/?$/i)
        : null
    const azureRun =
      url.hostname.toLowerCase() === 'dev.azure.com' &&
      /^\/[^/]+\/[^/]+\/_build\/results\/?$/i.test(url.pathname) &&
      /^[1-9]\d*$/.test(url.searchParams.get('buildId') ?? '')
        ? url.pathname.match(/^\/([^/]+)\/([^/]+)\/_build\/results\/?$/i)
        : null
    const buildId = url.searchParams.get('buildId') ?? ''
    const jira = url.pathname.match(/^\/browse\/([A-Z][A-Z0-9_]*-[1-9]\d*)\/?$/)
    if (!azureRun) url.search = ''
    url.hash = ''
    const choices: LinkTarget[] = []
    for (const entry of overviews) {
      const name = runtimeComputerName(entry)
      if (jira) {
        for (const source of entry.snapshot?.workspace.jiraSources ?? []) {
          if (
            new URL(source.site).origin === url.origin &&
            jira[1].startsWith(`${source.project}-`)
          )
            choices.push({
              runtimeId: entry.profile.id,
              jiraSourceId: source.id,
              label: `${source.name || source.project} · ${name}`,
              kind: 'jira',
              itemId: jira[1],
              url: url.href,
            })
        }
      }
      for (const repository of entry.snapshot?.workspace.repositories ?? []) {
        if (repository.kind) continue
        if (
          jira &&
          repository.jira &&
          new URL(repository.jira.site).origin === url.origin &&
          jira[1].startsWith(`${repository.jira.project}-`)
        )
          choices.push({
            runtimeId: entry.profile.id,
            repositoryId: repository.id,
            label: `${repository.name} · ${name}`,
            kind: 'issue',
            itemId: jira[1],
            url: url.href,
          })
        const azure = azureIssue ?? azureRun
        if (azure) {
          const identity = pullRepositoryIdentity(repository)
          const prefix = `dev.azure.com/${azure[1]}/${azure[2]}/_git/`.toLowerCase()
          if (identity?.toLowerCase().startsWith(prefix))
            choices.push({
              runtimeId: entry.profile.id,
              repositoryId: repository.id,
              label: `${repository.name} · ${name}`,
              kind: azureIssue ? 'issue' : 'pipeline',
              itemId: azureIssue ? azureIssue[3] : buildId,
              url: url.href,
            })
        }
        const match = issue ?? run
        if (!match) continue
        const identity = pullRepositoryIdentity(repository)
        const remote = gitRemoteIdentity(`${url.origin}/${match[1]}`)
        if (!identity || remote !== identity) continue
        choices.push({
          runtimeId: entry.profile.id,
          repositoryId: repository.id,
          label: `${repository.name} · ${name}`,
          kind: issue ? 'issue' : 'pipeline',
          itemId: match[2],
          url: url.href,
        })
      }
    }
    return contextualChoices(choices, origin)
  } catch {
    return []
  }
}
