import { afterEach, expect, it, vi } from 'vite-plus/test'
import { fetchRuntimeReleases, newerRuntimeVersion } from './runtime-releases'
afterEach(() => vi.unstubAllGlobals())
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
