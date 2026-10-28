import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { sharingRecoverySecret } from './sharing-recovery.js'

it('persists the server sealing key privately and never replaces a missing or invalid key for existing recoveries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-sharing-recovery-'))
  const path = join(directory, 'sharing-recovery.key')
  try {
    expect(() => sharingRecoverySecret(path, true)).toThrow('Restore Connect')
    const secret = sharingRecoverySecret(path, false)
    expect(secret).toHaveLength(32)
    chmodSync(path, 0o644)
    expect(sharingRecoverySecret(path, true)).toEqual(secret)
    expect(process.platform === 'win32' || (statSync(path).mode & 0o777) === 0o600).toBe(true)
    expect(readFileSync(path)).toEqual(secret)
    writeFileSync(path, 'broken')
    expect(() => sharingRecoverySecret(path, false)).toThrow('Invalid Connect')
    expect(readFileSync(path, 'utf8')).toBe('broken')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
