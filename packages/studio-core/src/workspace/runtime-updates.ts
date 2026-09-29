import { useCallback, useEffect, useRef, useState } from 'react'
import type { RuntimeSnapshot } from '@dovo/protocol'

type Release = { version: string; notes: string; url: string }
type Releases = { stable?: Release; nightly?: Release }
let cached: Promise<Releases> | undefined

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

async function releases(): Promise<Releases> {
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
  const result: Releases = {}
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

export function useRuntimeReleaseCheck() {
  const generation = useRef(0)
  const [state, setState] = useState<{ releases?: Releases; error?: string; checking: boolean }>({
    checking: true,
  })
  const check = useCallback((force = false) => {
    const current = ++generation.current
    if (force) cached = undefined
    cached ??= releases().catch((error) => {
      cached = undefined
      throw error
    })
    setState((current) => ({ ...current, checking: true, error: undefined }))
    void cached.then(
      (next) => {
        if (generation.current === current) setState({ releases: next, checking: false })
      },
      (error: unknown) =>
        generation.current === current &&
        setState({
          checking: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
  }, [])
  useEffect(() => {
    check()
    const timer = setInterval(() => check(true), 60 * 60 * 1000)
    return () => {
      generation.current++
      clearInterval(timer)
    }
  }, [check])
  return { ...state, check: () => check(true) }
}

export function runtimeUpdate(
  snapshot: RuntimeSnapshot | null | undefined,
  releases: Releases | undefined,
) {
  const installed = snapshot?.releaseVersion
  const latest = installed?.includes('-nightly.') ? releases?.nightly : releases?.stable
  return {
    installed,
    latest,
    available: !!installed && !!latest && newerRuntimeVersion(latest.version, installed),
  }
}
