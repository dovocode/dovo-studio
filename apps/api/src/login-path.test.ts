import { expect, it } from 'vite-plus/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knownToolDirectories, loginShellPath, mergePath } from './login-path.js'

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
