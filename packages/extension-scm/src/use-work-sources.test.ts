import { expect, it } from 'vitest'
import { reusableOptions } from './use-work-sources'

it('reuses fresh options only for the same scope and mode without a forced refresh', () => {
  const options = { issues: true }
  const page = {
    source: { scope: 'same-source' },
    optionsMode: 'issues',
    optionsFetchedAt: 1_000,
    options,
  }

  expect(reusableOptions(page, { scope: 'same-source' }, 'issues', false, 1_500)).toBe(options)
  expect(reusableOptions(page, { scope: 'same-source' }, 'issues', false, 61_000)).toBeUndefined()
  expect(
    reusableOptions(
      { source: page.source, optionsMode: 'issues', options },
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
