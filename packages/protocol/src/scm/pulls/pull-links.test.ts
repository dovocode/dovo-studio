import { expect, it } from 'vitest'
import { pullReferencesInText } from './pull-links'
it('extracts normalized PR links from Markdown and prose across supported forge URL shapes', () => {
  expect(
    pullReferencesInText(
      'See [PR](https://github.com/o/r/pull/7?tab=checks#note). Also https://gitlab.example/o/r/-/merge_requests/8, and https://github.com/o/r/pull/7.',
    ),
  ).toEqual([
    { number: 7, url: 'https://github.com/o/r/pull/7' },
    { number: 8, url: 'https://gitlab.example/o/r/-/merge_requests/8' },
  ])
  expect(
    pullReferencesInText(
      '#123 https://github.com/o/r/issues/1 https://secret@host/pull/1 https://host/pull/0',
    ),
  ).toEqual([])
})
