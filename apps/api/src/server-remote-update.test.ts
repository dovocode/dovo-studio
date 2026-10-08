import { afterEach, expect, it, vi } from 'vite-plus/test'
import { releaseAsset } from './server-remote-update.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('accepts only the matching published server archive with a SHA-256 digest', async () => {
  const version = '0.0.7-nightly.42'
  const name = `Dovo-Server-Nightly-${version}-${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}.tar.gz`
  const asset = {
    name,
    browser_download_url: `https://github.com/dovocode/dovo-studio/releases/download/v${version}/${name}`,
    digest: `sha256:${'a'.repeat(64)}`,
    size: 123,
  }
  const reply = { draft: false, prerelease: true, assets: [asset] }
  vi.stubEnv('GH_TOKEN', 'gh_fixture')
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(reply))
  vi.stubGlobal('fetch', fetcher)
  await expect(releaseAsset(version, 'nightly')).resolves.toMatchObject({
    url: asset.browser_download_url,
    digest: 'a'.repeat(64),
    size: 123,
  })
  expect(new Headers(fetcher.mock.calls[0]![1]!.headers).get('Authorization')).toBe(
    'Bearer gh_fixture',
  )
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json({ ...reply, assets: [{ ...asset, digest: '' }] }),
    ),
  )
  await expect(releaseAsset(version, 'nightly')).rejects.toThrow('verified')
})
