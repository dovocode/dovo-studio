import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserCdpInstructions } from './browser-cdp'

afterEach(() => vi.unstubAllEnvs())
it('advertises only this task’s active desktop preview and ignores remote servers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-cdp-context-'))
  try {
    vi.stubEnv('DOVO_RELEASE_DISTRIBUTION', 'desktop')
    vi.stubEnv('DOVO_DATABASE_PATH', join(directory, 'runtime.sqlite'))
    const endpoint = `ws://127.0.0.1:12345/${'a'.repeat(64)}/devtools/page/1`
    writeFileSync(
      join(directory, 'desktop-browser-host.json'),
      JSON.stringify({
        pid: process.pid,
        targets: [{ taskId: 'mine', profileId: 'work', endpoint }],
      }),
    )
    expect(browserCdpInstructions('mine')).toContain(endpoint)
    expect(browserCdpInstructions('mine')).toContain('page endpoint')
    expect(browserCdpInstructions('other')).toBe('')
    vi.stubEnv('DOVO_RELEASE_DISTRIBUTION', 'server')
    expect(browserCdpInstructions('mine')).toBe('')
    vi.stubEnv('DOVO_RELEASE_DISTRIBUTION', 'desktop')
    writeFileSync(join(directory, 'desktop-browser-host.json'), '{}')
    expect(browserCdpInstructions('mine')).toBe('')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
