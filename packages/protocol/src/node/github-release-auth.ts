import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const tokenValue = (value: string | undefined) => {
  const token = value?.trim()
  return token && /^[A-Za-z0-9_]+$/.test(token) ? token : undefined
}
let pending: Promise<string | undefined> | undefined

/** Read existing credentials without prompting, logging them, or creating a new login. */
export async function githubReleaseToken(): Promise<string | undefined> {
  const configured = tokenValue(process.env.GH_TOKEN) ?? tokenValue(process.env.GITHUB_TOKEN)
  if (configured) return configured
  if (pending) return pending
  const request = execute('gh', ['auth', 'token', '--hostname', 'github.com'], {
    cwd: homedir(),
    env: {
      ...process.env,
      // GUI apps and user services may omit the usual user/Homebrew CLI directories.
      PATH: [
        ...(process.env.PATH ? [process.env.PATH] : []),
        join(homedir(), '.local', 'bin'),
        ...(process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : []),
      ].join(delimiter),
      GH_PROMPT_DISABLED: '1',
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024,
  }).then(
    ({ stdout }) => tokenValue(stdout),
    () => undefined, // Missing CLI, no login, and lookup failures retain anonymous access.
  )
  pending = request
  try {
    return await request
  } finally {
    if (pending === request) pending = undefined
  }
}

/** Credentials apply only to GitHub's API, never public archives or fallback metadata. */
export const fetchGitHubRelease: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  )
  if (url.origin !== 'https://api.github.com') return fetch(input, init)
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  )
  if (!headers.has('Authorization')) {
    const token = await githubReleaseToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  // Release API URLs are fixed; do not forward credentials through an unexpected redirect.
  return fetch(input, { ...init, headers, redirect: 'error' })
}
