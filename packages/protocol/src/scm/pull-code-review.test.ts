import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import {
  pullCodeReviewDraftSchema,
  pullCodeReviewBody,
  pullFindingText,
  pullReviewReferences,
} from './pull-code-review.js'

it('quotes generated Markdown and neutralizes generated mentions without changing user drafts', () => {
  const text = pullFindingText({
    id: 'bug',
    path: 'src/file.ts',
    side: 'after',
    line: 12,
    severity: 'high',
    title: 'Check @team #12',
    trigger: '![image](https://example.com/image) <script>',
    impact: 'Use **bold**',
    suggestion: 'Keep `source`',
    anchored: true,
  })
  expect(text).toContain('@\u200bteam')
  expect(text).toContain('\\#12')
  expect(text).toContain('\\!\\[image\\]')
  expect(text).not.toContain('<script>')
  const draft = decode(pullCodeReviewDraftSchema, {
    body: 'My @team review\n\n',
    selected: [],
    dismissed: [],
    event: 'comment',
  })
  expect(pullCodeReviewBody({ id: 'report', headSha: 'head', draft })).toBe(
    'My @team review\n\n<!-- dovo-review:report:head -->',
  )
})
it('lists links and notification references in the exact publication text', () => {
  expect(
    pullReviewReferences(
      'Ask @person and @team/review about #12 and owner/repo#42. https://example.com. @person',
    ),
  ).toEqual(['@person', '@team/review', '#12', 'owner/repo#42', 'https://example.com.'])
})
