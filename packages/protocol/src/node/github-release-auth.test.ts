/// <reference types="node" />
import type { ExecFileOptions } from 'node:child_process'
import { delimiter } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'

const fixture = vi.hoisted(() => ({
  execute:
    vi.fn<
      (
        file: string,
        args: string[],
        options: ExecFileOptions,
      ) => Promise<{ stdout: string; stderr: string }>
    >(),
}))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: fixture.execute }) }
})
import { fetchGitHubRelease, githubReleaseToken } from './github-release-auth'

beforeEach(() => {
  vi.stubEnv('GH_TOKEN', '')
  vi.stubEnv('GITHUB_TOKEN', '')
  fixture.execute.mockReset().mockResolvedValue({ stdout: 'gho_fixture\n', stderr: '' })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('finds Homebrew CLI directories for macOS GUI launches while preserving PATH precedence', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.stubEnv('PATH', ['/fixture/tools', '/usr/bin'].join(delimiter))
  expect(await githubReleaseToken()).toBe('gho_fixture')
  const path = fixture.execute.mock.calls[0]![2].env?.PATH?.split(delimiter)
  expect(path?.slice(0, 2)).toEqual(['/fixture/tools', '/usr/bin'])
  expect(path?.slice(-2)).toEqual(['/opt/homebrew/bin', '/usr/local/bin'])
})

it('prefers explicit tokens to the existing GitHub CLI login', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'github_fixture')
  vi.stubEnv('GH_TOKEN', 'gh_fixture')
  expect(await githubReleaseToken()).toBe('gh_fixture')
  vi.stubEnv('GH_TOKEN', '')
  expect(await githubReleaseToken()).toBe('github_fixture')
  expect(fixture.execute).not.toHaveBeenCalled()
})

it('shares concurrent bounded, noninteractive token lookups for github.com', async () => {
  expect(await Promise.all([githubReleaseToken(), githubReleaseToken()])).toEqual([
    'gho_fixture',
    'gho_fixture',
  ])
  expect(fixture.execute).toHaveBeenCalledOnce()
  expect(fixture.execute).toHaveBeenCalledWith(
    'gh',
    ['auth', 'token', '--hostname', 'github.com'],
    expect.objectContaining({
      timeout: 5000,
      killSignal: 'SIGKILL',
      windowsHide: true,
      env: expect.objectContaining({ GH_PROMPT_DISABLED: '1' }),
    }),
  )
  fixture.execute.mockResolvedValue({ stdout: 'gho_new_login', stderr: '' })
  expect(await githubReleaseToken()).toBe('gho_new_login')
})

it.each(['missing CLI', 'no login', 'timeout'])(
  'retains anonymous requests after %s',
  async (message) => {
    fixture.execute.mockRejectedValue(new Error(message))
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({}))
    vi.stubGlobal('fetch', fetcher)
    await fetchGitHubRelease('https://api.github.com/repos/dovocode/dovo-studio/releases')
    expect(new Headers(fetcher.mock.calls[0]![1]!.headers).has('Authorization')).toBe(false)
  },
)

it('adds credentials only to GitHub API requests and preserves request options', async () => {
  vi.stubEnv('GH_TOKEN', 'gh_fixture')
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({}))
  vi.stubGlobal('fetch', fetcher)
  const signal = AbortSignal.timeout(1000)
  await fetchGitHubRelease('https://api.github.com/repos/dovocode/dovo-studio/releases', {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
    cache: 'no-store',
  })
  const options = fetcher.mock.calls[0]![1]!
  expect(new Headers(options.headers).get('Authorization')).toBe('Bearer gh_fixture')
  expect(new Headers(options.headers).get('Accept')).toBe('application/vnd.github+json')
  expect(options).toMatchObject({ signal, cache: 'no-store', redirect: 'error' })
  for (const url of [
    'https://github.com/dovocode/dovo-studio/releases/download/v1.2.3/server.tar.gz',
    'https://raw.githubusercontent.com/dovocode/dovo-studio/main/Casks/dovo-studio.rb',
    'http://api.github.com/releases',
    'https://api.github.com.example.com/releases',
  ]) {
    await fetchGitHubRelease(url)
    expect(fetcher).toHaveBeenLastCalledWith(url, undefined)
  }
  expect(fixture.execute).not.toHaveBeenCalled()
})

it('rejects malformed credential output without leaking it into headers', async () => {
  fixture.execute.mockResolvedValue({ stdout: 'token\nAuthorization: injected', stderr: '' })
  expect(await githubReleaseToken()).toBeUndefined()
})
