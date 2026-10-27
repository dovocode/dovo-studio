import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultBrowserStatus,
  requestDefaultBrowser,
  registerDefaultBrowser,
} from './default-browser'

const mocks = vi.hoisted(() => ({
  packaged: true,
  isDefault: vi.fn<(scheme: string) => boolean>(() => false),
  setDefault: vi.fn<(scheme: string) => boolean>(() => true),
  open: vi.fn<(url: string) => Promise<void>>(() => Promise.resolve()),
  handle: vi.fn<(channel: string, callback: (event: unknown) => unknown) => void>(),
  trust: vi.fn<(event: unknown, path: string) => void>(),
}))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.packaged
    },
    isDefaultProtocolClient: mocks.isDefault,
    setAsDefaultProtocolClient: mocks.setDefault,
  },
  shell: { openExternal: mocks.open },
  ipcMain: { handle: mocks.handle },
}))
vi.mock('./renderer-trust.js', () => ({ requireTrustedRenderer: mocks.trust }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  mocks.packaged = true
})

it('requires both HTTP and HTTPS and preserves OS confirmation on macOS', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  mocks.isDefault.mockImplementation((scheme) => scheme === 'http')
  expect(await defaultBrowserStatus(false)).toEqual({ supported: true, isDefault: false })
  await requestDefaultBrowser(false)
  expect(mocks.setDefault.mock.calls).toEqual([['http'], ['https']])
  mocks.setDefault.mockReturnValue(false)
  await requestDefaultBrowser(false)
  expect(mocks.open).toHaveBeenCalledWith(
    'x-apple.systempreferences:com.apple.Desktop-Settings.extension',
  )
  mocks.setDefault.mockReturnValue(true)
})

it('opens Windows Default apps without trying to overwrite UserChoice', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  await requestDefaultBrowser(true)
  expect(mocks.open).toHaveBeenCalledWith('ms-settings:defaultapps')
  expect(mocks.setDefault).not.toHaveBeenCalled()
})

it('uses installed Linux desktop identities and detects mismatched protocol handlers', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-default-browser-'))
  try {
    await writeFile(
      join(directory, 'xdg-mime'),
      '#!/bin/sh\ncase "$3" in *https) echo "$DOVO_TEST_HTTPS";; *) echo com.dovo.studio.nightly.desktop;; esac\n',
      { mode: 0o755 },
    )
    await writeFile(
      join(directory, 'xdg-settings'),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$DOVO_TEST_RESULT"\nexit "${DOVO_TEST_STATUS:-0}"\n',
      { mode: 0o755 },
    )
    vi.stubEnv('PATH', `${directory}:${process.env.PATH}`)
    vi.stubEnv('DOVO_TEST_RESULT', join(directory, 'result'))
    vi.stubEnv('DOVO_TEST_HTTPS', 'other.desktop')
    expect(await defaultBrowserStatus(true)).toEqual({ supported: true, isDefault: false })
    vi.stubEnv('DOVO_TEST_HTTPS', 'com.dovo.studio.nightly.desktop')
    expect(await defaultBrowserStatus(true)).toEqual({ supported: true, isDefault: true })
    await requestDefaultBrowser(true)
    expect(await readFile(join(directory, 'result'), 'utf8')).toBe(
      'set\ndefault-web-browser\ncom.dovo.studio.nightly.desktop\n',
    )
    vi.stubEnv('DOVO_TEST_STATUS', '1')
    await expect(requestDefaultBrowser(false)).rejects.toThrow('Command failed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('keeps unpackaged apps out of OS defaults and rejects untrusted IPC', async () => {
  mocks.packaged = false
  expect(await defaultBrowserStatus(false)).toEqual({ supported: false, isDefault: false })
  await expect(requestDefaultBrowser(false)).rejects.toThrow('Install Dovo Studio')
  registerDefaultBrowser('/app/index.html', false)
  mocks.trust.mockImplementation(() => {
    throw new Error('Untrusted desktop request')
  })
  for (const [, callback] of mocks.handle.mock.calls)
    expect(() => callback({})).toThrow('Untrusted desktop request')
  expect(mocks.open).not.toHaveBeenCalled()
  mocks.trust.mockReset()
})
