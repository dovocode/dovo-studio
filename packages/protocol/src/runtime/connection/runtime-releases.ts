import type { RuntimeSnapshot } from './runtime.js'

export type RuntimeRelease = { version: string; notes: string; url: string }
export type RuntimeReleases = { stable?: RuntimeRelease; nightly?: RuntimeRelease }

function versionParts(value: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-nightly\.(\d+))?$/.exec(value)
  return match
    ? match.slice(1).map((part) => (part === undefined ? Number.MAX_SAFE_INTEGER : Number(part)))
    : undefined
}
export function newerRuntimeVersion(a: string, b: string) {
  const left = versionParts(a),
    right = versionParts(b)
  if (!left || !right) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] > right[index]
  }
  return false
}

async function fetchGitHubReleases(): Promise<RuntimeReleases> {
  const options: RequestInit = {
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  }
  const [response, stableResponse] = await Promise.all([
    fetch('https://api.github.com/repos/dovocode/dovo-studio/releases?per_page=100', options),
    fetch('https://api.github.com/repos/dovocode/dovo-studio/releases/latest', options),
  ])
  if (!response.ok) throw new Error(`Release check failed (HTTP ${response.status})`)
  if (!stableResponse.ok && stableResponse.status !== 404)
    throw new Error(`Stable release check failed (HTTP ${stableResponse.status})`)
  const value: unknown = await response.json()
  if (!Array.isArray(value)) throw new Error('Unexpected release list')
  const result: RuntimeReleases = {}
  for (const item of [...value, ...(stableResponse.ok ? [await stableResponse.json()] : [])]) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('tag_name' in item) ||
      typeof item.tag_name !== 'string' ||
      !('html_url' in item) ||
      typeof item.html_url !== 'string'
    )
      continue
    if (!item.html_url.startsWith('https://github.com/dovocode/dovo-studio/releases/')) continue
    const channel = item.tag_name.includes('-nightly.') ? 'nightly' : 'stable'
    const release = {
      version: item.tag_name.replace(/^v/, ''),
      notes: 'body' in item && typeof item.body === 'string' ? item.body : '',
      url: item.html_url,
    }
    if (!versionParts(release.version)) continue
    if (!result[channel] || newerRuntimeVersion(release.version, result[channel].version))
      result[channel] = release
  }
  return result
}

/** Published tap definitions remain readable when the unauthenticated REST API is rate limited. */
async function publishedRuntimeReleases(): Promise<RuntimeReleases> {
  const channels = ['stable', 'nightly'] as const
  const entries = await Promise.all(
    channels.map(async (channel) => {
      const file = channel === 'nightly' ? 'dovo-studio-nightly.rb' : 'dovo-studio.rb'
      const response = await fetch(
        `https://raw.githubusercontent.com/dovocode/dovo-studio/main/Casks/${file}`,
        { cache: 'no-store', signal: AbortSignal.timeout(15000) },
      )
      if (response.status === 404) return undefined
      if (!response.ok)
        throw new Error(`Published ${channel} release check failed (HTTP ${response.status})`)
      const source = await response.text()
      const version = /^\s*version "([^"\r\n]+)"\s*$/m.exec(source)?.[1]
      if (
        !version ||
        !versionParts(version) ||
        (version.includes('-nightly.') ? 'nightly' : 'stable') !== channel
      )
        throw new Error(`Invalid published ${channel} release version`)
      const url = `https://github.com/dovocode/dovo-studio/releases/tag/v${version}`
      if (!source.includes(`/releases/download/v${version}/`))
        throw new Error(`Invalid published ${channel} release address`)
      return [channel, { version, notes: '', url }] as const
    }),
  )
  if (!entries.some(Boolean)) throw new Error('No published release metadata is available')
  return Object.fromEntries(entries.filter((entry) => entry !== undefined))
}
let pending: Promise<RuntimeReleases> | undefined
export function fetchRuntimeReleases(): Promise<RuntimeReleases> {
  if (pending) return pending
  const request = fetchGitHubReleases().catch(async (cause: unknown) => {
    try {
      return await publishedRuntimeReleases()
    } catch (fallback: unknown) {
      throw new AggregateError(
        [cause, fallback],
        `Could not check releases: ${fallback instanceof Error ? fallback.message : String(fallback)}`,
      )
    }
  })
  pending = request
  const clear = () => {
    if (pending === request) pending = undefined
  }
  void request.then(clear, clear)
  return request
}

export function runtimeUpdate(
  snapshot: RuntimeSnapshot | null | undefined,
  releases: RuntimeReleases | undefined,
) {
  const installed = snapshot?.releaseVersion
  const channel =
    snapshot?.releaseDistribution === 'desktop' ? snapshot.desktopApp?.channel : undefined
  const latest =
    (channel ?? (installed?.includes('-nightly.') ? 'nightly' : 'stable')) === 'nightly'
      ? releases?.nightly
      : releases?.stable
  return {
    installed,
    latest,
    available:
      !!installed &&
      !!latest &&
      latest.version !== installed &&
      (newerRuntimeVersion(latest.version, installed) ||
        (!!channel && channel !== (installed.includes('-nightly.') ? 'nightly' : 'stable'))),
  }
}
