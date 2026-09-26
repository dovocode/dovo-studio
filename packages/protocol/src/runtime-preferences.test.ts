import { expect, it } from 'vitest'
import { decodeResult } from './schema.js'
import { normalizeBranchPrefix, runtimePreferencesSchema } from './runtime.js'

it('defaults new preferences and accepts only Git-safe branch prefixes', () => {
  const defaults = decodeResult(runtimePreferencesSchema, {})
  expect(defaults.success && defaults.data).toMatchObject({
    branchPrefix: 'dovo/',
    autoArchiveDays: 0,
    activityRetentionDays: 0,
  })
  const valid = (branchPrefix: string) =>
    decodeResult(runtimePreferencesSchema, { branchPrefix }).success
  for (const prefix of ['', 'dovo/', 'feature/', 'team/me/', 'v1.2/'])
    expect(valid(prefix)).toBe(true)
  for (const prefix of ['bad', '../x/', 'a b/', '-x/', 'x//', 'a..b/', 'x.lock/', 'x./'])
    expect(valid(prefix)).toBe(false)
  expect(normalizeBranchPrefix(' feature ')).toEqual({ prefix: 'feature/', valid: true })
  expect(normalizeBranchPrefix('')).toEqual({ prefix: '', valid: true })
  expect(normalizeBranchPrefix('a b')).toMatchObject({ valid: false })
})
