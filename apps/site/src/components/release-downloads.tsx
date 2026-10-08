'use client'

import { useEffect, useState } from 'react'
import { releases, repository } from './site-links'

type Nightly = { name: string; url: string; publishedAt: string }

function newestNightly(value: unknown): Nightly | null {
  if (!Array.isArray(value)) throw new Error('Invalid release response')
  const entries: readonly unknown[] = value
  const candidates: Nightly[] = []
  for (const item of entries) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('draft' in item) ||
      item.draft !== false ||
      !('prerelease' in item) ||
      item.prerelease !== true ||
      !('tag_name' in item) ||
      typeof item.tag_name !== 'string' ||
      !/^v\d+\.\d+\.\d+-nightly\.\d+$/.test(item.tag_name) ||
      !('html_url' in item) ||
      typeof item.html_url !== 'string' ||
      item.html_url !== `${repository}/releases/tag/${item.tag_name}` ||
      !('published_at' in item) ||
      typeof item.published_at !== 'string' ||
      !Number.isFinite(Date.parse(item.published_at))
    )
      continue
    candidates.push({
      name: item.tag_name.slice(1),
      url: item.html_url,
      publishedAt: item.published_at,
    })
  }
  return candidates.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] ?? null
}

const platforms = [
  {
    name: 'macOS',
    symbol: '⌘',
    architecture: 'Apple silicon · ARM64',
    formats: 'DMG or ZIP',
    detail: 'Developer ID signed and notarized.',
  },
  {
    name: 'Windows',
    symbol: '⊞',
    architecture: 'x64 & ARM64',
    formats: 'EXE installer',
    detail: 'Signed with Azure Artifact Signing.',
  },
  {
    name: 'Linux',
    symbol: '⋊',
    architecture: 'x64 & ARM64',
    formats: 'AppImage, DEB or RPM',
    detail: 'Choose the format for your distribution.',
  },
]
const nightlyReleases = `${repository}/releases?q=nightly&expanded=true`

export function ReleaseDownloads() {
  const [channel, setChannel] = useState<'stable' | 'nightly'>('stable')
  const [nightly, setNightly] = useState<Nightly | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(
          'https://api.github.com/repos/dovocode/dovo-studio/releases?per_page=100',
          {
            headers: { Accept: 'application/vnd.github+json' },
            signal: controller.signal,
          },
        )
        if (!response.ok) throw new Error(`Release lookup failed (${response.status})`)
        const body: unknown = await response.json()
        const latest = newestNightly(body)
        if (!controller.signal.aborted) {
          setNightly(latest)
          setStatus(latest ? 'ready' : 'unavailable')
        }
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable')
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  const isNightly = channel === 'nightly'
  const url = isNightly ? (nightly?.url ?? nightlyReleases) : releases
  return (
    <>
      <div className="release-channels" role="group" aria-label="Release channel">
        <button type="button" aria-pressed={!isNightly} onClick={() => setChannel('stable')}>
          <strong>Stable</strong>
          <span>Recommended for everyday work</span>
        </button>
        <button type="button" aria-pressed={isNightly} onClick={() => setChannel('nightly')}>
          <strong>Nightly</strong>
          <span>Try the latest changes</span>
        </button>
      </div>
      <div className="channel-description" aria-live="polite">
        {isNightly ? (
          <>
            <p>
              Nightly builds are prereleases with the newest changes. They may be less reliable than
              Stable.
            </p>
            {status === 'ready' && nightly && (
              <p>
                <a href={nightly.url}>Latest nightly: {nightly.name} ↗</a> · Published{' '}
                {new Date(nightly.publishedAt).toLocaleDateString('en', {
                  dateStyle: 'medium',
                  timeZone: 'UTC',
                })}
              </p>
            )}
            {status === 'loading' && (
              <p>
                Checking the latest published nightly… You can also browse nightly releases below.
              </p>
            )}
            {status === 'unavailable' && (
              <p>
                The latest nightly could not be loaded. Browse the published nightly releases on
                GitHub below.
              </p>
            )}
          </>
        ) : (
          <p>
            Use the latest stable release for everyday work. Nightly builds are available when you
            want to try what’s next.
          </p>
        )}
      </div>
      <div className="feature-grid downloads">
        {platforms.map((platform) => (
          <article className="feature-card" key={platform.name}>
            <span className="feature-symbol" aria-hidden="true">
              {platform.symbol}
            </span>
            <h2>{platform.name}</h2>
            <p>
              {platform.architecture}
              <br />
              {platform.formats}
            </p>
            <a className="button" href={url}>
              View {platform.name} {isNightly ? 'nightlies' : 'downloads'}{' '}
              <span aria-hidden="true">↗</span>
            </a>
            <small>{platform.detail}</small>
          </article>
        ))}
      </div>
      <p className="download-note">
        Downloads open{' '}
        {isNightly ? 'the published nightly releases' : 'the latest stable GitHub release'}. Under
        Assets, select the installer matching your operating system and architecture.{' '}
        <a href={`${repository}/releases`}>All releases ↗</a>
      </p>
      {isNightly && (
        <p className="download-note">
          Stable and Nightly use separate app identities but share workspace and pairing data. Run
          one local runtime at a time. You can also choose the release channel in Settings → General
          → Updates.
        </p>
      )}
    </>
  )
}
