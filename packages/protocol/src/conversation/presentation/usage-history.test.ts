import { expect, it } from 'vite-plus/test'
import { mergeUsageNotices } from './usage-history.js'

it('shows shared transcript warnings once and retains unrelated or unverified warnings', () => {
  const warning = 'claude: skipped an incomplete transcript row.'
  const windows = { id: 'windows', notices: [warning], sources: { [warning]: ['shared'] } }
  const linux = {
    id: 'wsl',
    notices: [warning, 'Offline cache unavailable.'],
    sources: { [warning]: ['shared'] },
  }
  expect(mergeUsageNotices([windows, linux])).toEqual({
    windows: warning,
    wsl: 'Offline cache unavailable.',
  })
  expect(
    mergeUsageNotices([windows, { ...linux, sources: { [warning]: ['shared', 'distinct'] } }]).wsl,
  ).toContain(warning)
  expect(mergeUsageNotices([windows, { ...linux, sources: undefined }]).wsl).toContain(warning)
  expect(mergeUsageNotices([linux]).wsl).toContain(warning)
})
