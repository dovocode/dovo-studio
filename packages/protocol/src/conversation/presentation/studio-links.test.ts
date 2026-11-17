import { expect, it } from 'vite-plus/test'
import { parseStudioLink, threadReferenceLink, studioNavigationURL } from './studio-links.js'

it('opens known settings and scoped thread destinations without mutation parameters', () => {
  expect(parseStudioLink('dovo://settings/speech?field=Voice%20pause')).toMatchObject({
    kind: 'settings',
    viewId: 'conversation-settings',
    mobilePath: '/settings/speech',
    field: 'Voice pause',
  })
  const link = threadReferenceLink('runtime', 'older thread')
  expect(parseStudioLink(link)).toEqual({
    kind: 'thread',
    runtimeId: 'runtime',
    threadId: 'older thread',
  })
  expect(parseStudioLink(studioNavigationURL(link) ?? '')).toEqual(parseStudioLink(link))
  for (const value of [
    'dovo://settings/unknown',
    'dovo://user@settings/speech',
    'dovo://settings/speech#change',
    'dovo://thread?runtimeId=a&threadId=%00',
    'javascript:alert(1)',
  ])
    expect(parseStudioLink(value)).toBeUndefined()
})
