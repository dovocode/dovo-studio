import { expect, it } from 'vite-plus/test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knownToolDirectories, loginShellPath, mergePath } from './login-path.js'
import * as loginPath from './login-path.js'

it('puts login-shell entries first without duplicating the app PATH', () => {
  expect(
    mergePath('/usr/bin:/bin', '/Users/me/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin'),
  ).toBe('/Users/me/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin:/bin')
  expect(mergePath('/usr/bin:/bin', undefined)).toBe('/usr/bin:/bin')
})

it('reads only the marked PATH from a shell that prints banners', () => {
  const path = loginShellPath({ SHELL: '/bin/sh', PATH: '/usr/bin:/bin', HOME: '/tmp' })
  expect(path).toContain('/usr/bin')
  expect(path).not.toContain('__DOVO_LOGIN_PATH__')
})

it('falls back quietly when the shell cannot run', () => {
  expect(loginShellPath({ SHELL: '/nonexistent/shell', PATH: '/usr/bin' })).toBeUndefined()
})

it('adds existing version-manager shims that a prompt hook would have added', () => {
  const home = mkdtempSync(join(tmpdir(), 'dovo-home-'))
  mkdirSync(join(home, '.local/share/mise/shims'), { recursive: true })
  const known = knownToolDirectories({ HOME: home })
  expect(known).toContain(join(home, '.local/share/mise/shims'))
  expect(known).not.toContain(join(home, '.cargo/bin'))
  expect(mergePath('/usr/bin:/bin', '/usr/bin', known)).toBe(`/usr/bin:${known.join(':')}:/bin`)
})

it.skipIf(process.platform === 'win32')(
  'refreshes the login path in place and shares concurrent requests',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dovo-refresh-path-'))
    try {
      const shell = join(directory, 'shell')
      const pathFile = join(directory, 'path')
      const env = { SHELL: shell, PATH: '/usr/bin:/bin', DOVO_TEST_PATH_FILE: pathFile }
      writeFileSync(
        shell,
        '#!/bin/sh\nprintf "__DOVO_LOGIN_PATH__%s__DOVO_LOGIN_PATH__" "$(cat "$DOVO_TEST_PATH_FILE")"\n',
        { mode: 0o700 },
      )
      writeFileSync(pathFile, '/before:/usr/bin')
      if (
        !('refreshableLoginPath' in loginPath) ||
        typeof loginPath.refreshableLoginPath !== 'function'
      )
        throw new Error('The runtime does not expose a login PATH refresh')
      const refresh = loginPath.refreshableLoginPath(env)
      expect(env.PATH).toBe('/before:/usr/bin:/bin')
      writeFileSync(pathFile, '/after:/usr/bin')
      const pending = refresh()
      expect(refresh()).toBe(pending)
      await pending
      expect(env.PATH).toBe('/after:/usr/bin:/bin')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
