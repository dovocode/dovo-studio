import { gitRemoteIdentity } from '../../runtime/connection/project-machines.js'
import type { Task } from '../../workspace.js'
import type { ForgeProvider } from '../forges/forges.js'
export function pullReference(input: string): { number: number; url?: string } {
  const text = input.trim()
  if (/^#?\d+$/.test(text)) {
    const number = Number(text.replace('#', ''))
    if (Number.isSafeInteger(number) && number > 0) return { number }
  }
  try {
    const url = new URL(text)
    const match = url.pathname.match(
      /\/(?:pull|pulls|pull-requests|pullrequest|merge_requests)\/(\d+)\/?$/i,
    )
    const number = Number(match?.[1])
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      Number.isSafeInteger(number) &&
      number > 0
    ) {
      url.hash = ''
      url.search = ''
      return { number, url: url.href.replace(/\/$/, '') }
    }
  } catch {
    // Fall through to the same actionable validation message for malformed URLs.
  }
  throw new Error('Enter a PR number or a full pull request URL.')
}

export function verifyPullUrl(input: string | undefined, actual: string) {
  if (!input) return
  const url = new URL(actual)
  url.hash = ''
  url.search = ''
  if (input !== url.href.replace(/\/$/, ''))
    throw new Error('That PR belongs to a different project. Use a PR from this task’s project.')
}

/** Extract full PR URLs only; a bare issue number is too ambiguous to auto-link. */
export function pullReferencesInText(text: string) {
  const links = new Map<string, { number: number; url: string }>()
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    try {
      const reference = pullReference(match[0].replace(/[.,;:!?)\]}]+$/, ''))
      if (reference.url) links.set(reference.url, { number: reference.number, url: reference.url })
    } catch {
      /* Other web links are not PR references. */
    }
  }
  return [...links.values()]
}

/** GitHub PR tabs and fragments still point to the same native PR detail. */
export function githubPullTarget(input: string) {
  try {
    const url = new URL(input)
    const match = url.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/(files|commits|checks))?\/?$/,
    )
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.port ||
      url.username ||
      url.password ||
      !match
    )
      return null
    const number = Number(match[3])
    if (!Number.isSafeInteger(number)) return null
    const repositoryUrl = `https://github.com/${match[1]}/${match[2]}`
    const canonicalUrl = `${repositoryUrl}/pull/${number}`
    const tab: 'overview' | 'changes' | 'checks' =
      match[4] === 'checks' ? 'checks' : match[4] ? 'changes' : 'overview'
    return {
      number,
      identity: gitRemoteIdentity(repositoryUrl),
      url: canonicalUrl,
      navigationUrl: `${canonicalUrl}${match[4] ? `/${match[4]}` : ''}${url.search}${url.hash}`,
      tab,
      fragment: url.hash,
    }
  } catch {
    return null
  }
}

/** Public hosts have known URL shapes. Private instances must match a configured
 * repository and provider exactly; a GitHub-looking path alone is not trusted. */
export function forgePullTarget(
  input: string,
  bindings: readonly { provider?: ForgeProvider; identity?: string }[] = [],
) {
  const github = githubPullTarget(input)
  if (github) return { ...github, provider: 'github' as const }
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const shapes = [
      {
        provider: 'github',
        expression: /^(\/.+?)\/pull\/([1-9]\d*)(?:\/(files|commits|checks))?\/?$/,
      },
      {
        provider: 'forgejo',
        expression: /^(\/.+?)\/pulls\/([1-9]\d*)(?:\/(files|commits|checks))?\/?$/,
      },
      {
        provider: 'gitea',
        expression: /^(\/.+?)\/pulls\/([1-9]\d*)(?:\/(files|commits|checks))?\/?$/,
      },
      {
        provider: 'gitlab',
        expression: /^(\/.+?)\/-\/merge_requests\/([1-9]\d*)(?:\/(diffs|commits|pipelines))?\/?$/,
      },
      {
        provider: 'azure-devops',
        expression: /^(\/.+?\/_git\/[^/]+)\/pullrequest\/([1-9]\d*)\/?$/i,
      },
      {
        provider: 'bitbucket',
        expression: /^(\/.+?)\/pull-requests\/([1-9]\d*)(?:\/(diff|commits))?\/?$/,
      },
    ] as const
    for (const { provider, expression } of shapes) {
      const match = url.pathname.match(expression)
      if (!match) continue
      const number = Number(match[2])
      if (!Number.isSafeInteger(number)) return null
      const repositoryUrl = `${url.origin}${match[1]}`
      const rawIdentity = gitRemoteIdentity(repositoryUrl)
      const identity = provider === 'github' ? rawIdentity?.toLowerCase() : rawIdentity
      if (!identity) return null
      if (
        !(provider === 'gitlab' && url.hostname === 'gitlab.com' && !url.port) &&
        !bindings.some(
          (binding) =>
            (!binding.provider || binding.provider === provider) &&
            (binding.provider === 'github'
              ? binding.identity?.toLowerCase() === identity
              : binding.identity === identity),
        )
      )
        continue
      const kind =
        provider === 'gitlab'
          ? '-/merge_requests'
          : ['forgejo', 'gitea'].includes(provider)
            ? 'pulls'
            : provider === 'bitbucket'
              ? 'pull-requests'
              : provider === 'azure-devops'
                ? 'pullrequest'
                : 'pull'
      const canonicalUrl = `${repositoryUrl}/${kind}/${number}`
      const tab: 'overview' | 'changes' | 'checks' = ['checks', 'pipelines'].includes(
        match[3] ?? '',
      )
        ? 'checks'
        : match[3]
          ? 'changes'
          : 'overview'
      return {
        provider,
        number,
        identity,
        url: canonicalUrl,
        navigationUrl: `${canonicalUrl}${match[3] ? `/${match[3]}` : ''}${url.search}${url.hash}`,
        tab,
        fragment: url.hash,
      }
    }
    return null
  } catch {
    return null
  }
}

/** Build a thread link from a full PR URL, including GitHub's detail tabs. */
export function threadPullLink(
  input: string,
  bindings: readonly { provider?: ForgeProvider; identity?: string }[] = [],
): NonNullable<Task['linkedPullRequests']>[number] | null {
  const target = forgePullTarget(input, bindings)
  try {
    const reference = pullReference(target?.url ?? input)
    if (!reference.url) return null
    return {
      number: reference.number,
      url: reference.url,
      title: `PR #${reference.number}`,
      ...(target ? { provider: target.provider } : {}),
      repositoryUrl: reference.url.replace(
        /\/(?:-\/)?(?:pull|pulls|pull-requests|pullrequest|merge_requests)\/\d+$/i,
        '',
      ),
    }
  } catch {
    return null
  }
}

export function addTaskPullLinks<
  T extends Pick<Task, 'linkedPullRequests' | 'pullRequest' | 'ignoredPullRequestUrls'>,
>(task: T, pulls: NonNullable<Task['linkedPullRequests']>): T {
  const links = new Map((task.linkedPullRequests ?? []).map((pull) => [pull.url, pull]))
  for (const pull of pulls) if (task.pullRequest?.url !== pull.url) links.set(pull.url, pull)
  if (links.size > 20) throw new Error('A thread can link at most 20 pull requests.')
  return {
    ...task,
    linkedPullRequests: [...links.values()],
    ignoredPullRequestUrls: (task.ignoredPullRequestUrls ?? []).filter(
      (url) => !pulls.some((pull) => pull.url === url),
    ),
  }
}
