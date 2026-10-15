import { expect, it } from 'vite-plus/test'
import { reusableOptions } from './work-source-page'

it('reuses fresh options only for the same scope and mode without a forced refresh', () => {
  const options = { issues: true }
  const page = {
    reader: { scope: 'same-source' },
    optionsMode: 'issues',
    optionsFetchedAt: 1_000,
    options,
  }

  expect(reusableOptions(page, { scope: 'same-source' }, 'issues', false, 1_500)).toBe(options)
  expect(reusableOptions(page, { scope: 'same-source' }, 'issues', false, 61_000)).toBeUndefined()
  expect(
    reusableOptions(
      { reader: page.reader, optionsMode: 'issues', options },
      { scope: 'same-source' },
      'issues',
      false,
      1_500,
    ),
  ).toBeUndefined()
  expect(reusableOptions(page, { scope: 'same-source' }, 'issues', false)).toBeUndefined()
  expect(reusableOptions(page, { scope: 'changed-source' }, 'issues', false, 1_500)).toBeUndefined()
  expect(reusableOptions(page, { scope: 'same-source' }, 'pipelines', false, 1_500)).toBeUndefined()
  expect(reusableOptions(page, { scope: 'same-source' }, 'issues', true, 1_500)).toBeUndefined()
})

it('does not reuse the origin options when a different reader takes over', () => {
  const page = {
    source: { scope: 'origin' },
    reader: { scope: 'alternate' },
    optionsMode: 'issues',
    optionsFetchedAt: 1_000,
    options: { issues: true },
  }
  expect(reusableOptions(page, page.source, 'issues', false, 1_500)).toBeUndefined()
  expect(reusableOptions(page, page.reader, 'issues', false, 1_500)).toBe(page.options)
})
