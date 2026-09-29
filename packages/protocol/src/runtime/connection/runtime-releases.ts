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

export async function fetchRuntimeReleases(): Promise<RuntimeReleases> {
  const options = {
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

export function runtimeUpdate(
  snapshot: RuntimeSnapshot | null | undefined,
  releases: RuntimeReleases | undefined,
) {
  const installed = snapshot?.releaseVersion
  const latest = installed?.includes('-nightly.') ? releases?.nightly : releases?.stable
  return {
    installed,
    latest,
    available: !!installed && !!latest && newerRuntimeVersion(latest.version, installed),
  }
}
