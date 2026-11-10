import { afterEach, expect, it, vi } from 'vite-plus/test'
import { fetchRuntimeReleases, newerRuntimeVersion } from './runtime-releases'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const tap = (version: string) =>
  new Response(
    `cask "dovo-studio" do\n  version "${version}"\n  url "https://github.com/dovocode/dovo-studio/releases/download/v${version}/app.zip"\nend`,
  )
it('uses published release metadata during GitHub rate limiting and shares concurrent checks', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('api.github.com')) return new Response('{}', { status: 403 })
    return tap(url.includes('nightly.rb') ? '0.0.7-nightly.171' : '0.0.7')
  })
  vi.stubGlobal('fetch', fetcher)
  const first = fetchRuntimeReleases(),
    second = fetchRuntimeReleases()
  expect(first).toBe(second)
  const releases = await first
  expect(releases.nightly?.version).toBe('0.0.7-nightly.171')
  expect(releases.stable?.version).toBe('0.0.7')
  expect(newerRuntimeVersion(releases.nightly!.version, '0.0.7-nightly.167')).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(4)
})
it('retains API release notes when available and does not query fallback metadata', async () => {
  const fetcher = vi.fn<typeof fetch>()
  fetcher.mockImplementation(
    async (input) =>
      new Response(
        JSON.stringify(
          (typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
          ).includes('latest')
            ? {
                tag_name: 'v0.0.7',
                html_url: 'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.7',
                body: 'Stable notes',
              }
            : [
                {
                  tag_name: 'mobile-v9.0.0-beta.2026102003',
                  html_url:
                    'https://github.com/dovocode/dovo-studio/releases/tag/mobile-v9.0.0-beta.2026102003',
                  draft: false,
                  prerelease: true,
                  body: 'Mobile beta notes',
                },
                {
                  tag_name: 'v0.0.7-nightly.171',
                  html_url:
                    'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.7-nightly.171',
                  body: 'Notes',
                },
              ],
        ),
      ),
  )
  vi.stubGlobal('fetch', fetcher)
  expect((await fetchRuntimeReleases()).nightly?.notes).toBe('Notes')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('uses only public API metadata without cookies or configured host credentials', async () => {
  vi.stubEnv('GH_TOKEN', 'fixture-host-token')
  const publicFetch = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith(
        '/latest',
      )
        ? {
            tag_name: 'v0.0.9',
            draft: false,
            html_url: 'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.9',
          }
        : [
            {
              tag_name: 'v0.0.9-nightly.767',
              draft: false,
              html_url: 'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.9-nightly.767',
              body: 'Public notes',
            },
          ],
    ),
  )
  vi.stubGlobal('fetch', publicFetch)
  const first = fetchRuntimeReleases()
  expect(fetchRuntimeReleases()).toBe(first)
  expect((await first).nightly).toMatchObject({
    version: '0.0.9-nightly.767',
    notes: 'Public notes',
  })
  expect(publicFetch).toHaveBeenCalledTimes(2)
  for (const [input, options] of publicFetch.mock.calls) {
    expect(input).toContain('https://api.github.com/')
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' })
    expect(new Headers(options?.headers).has('Authorization')).toBe(false)
  }
})

it('excludes drafts even if an API response unexpectedly includes them', async () => {
  const release = (version: string, draft = false) => ({
    tag_name: `v${version}`,
    html_url: `https://github.com/dovocode/dovo-studio/releases/tag/v${version}`,
    draft,
  })
  const publicFetch = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return Response.json(
      url.endsWith('/latest')
        ? release('1.2.3')
        : [
            release('9.0.0', true),
            release('9.0.0-nightly.999', true),
            { ...release('8.0.0'), prerelease: true },
            release('1.2.3-nightly.42'),
          ],
    )
  })
  vi.stubGlobal('fetch', publicFetch)
  const releases = await fetchRuntimeReleases()
  expect(releases.stable?.version).toBe('1.2.3')
  expect(releases.nightly?.version).toBe('1.2.3-nightly.42')
})
it('rejects invalid published metadata and allows a later explicit retry', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input) =>
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes(
        'api.github.com',
      )
        ? new Response('{}', { status: 429 })
        : tap('invalid'),
    )
  vi.stubGlobal('fetch', fetcher)
  await expect(fetchRuntimeReleases()).rejects.toThrow('Invalid published')
  fetcher.mockImplementation(async (input) =>
    (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes(
      'api.github.com',
    )
      ? new Response('{}', { status: 403 })
      : tap(
          (typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
          ).includes('nightly.rb')
            ? '0.0.7-nightly.172'
            : '0.0.7',
        ),
  )
  expect((await fetchRuntimeReleases()).nightly?.version).toBe('0.0.7-nightly.172')
})
