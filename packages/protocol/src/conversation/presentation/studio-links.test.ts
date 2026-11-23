import { expect, it } from 'vite-plus/test'
import { parseStudioLink, threadReferenceLink, studioNavigationURL } from './studio-links.js'
import { resolveMarkdownLink } from './markdown-links.js'

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

it('routes deployment thread references from chat through mobile Markdown link resolution', () => {
  const reference = 'studio:mac-runtime:thread:dory-deployment'
  const target = {
    kind: 'thread',
    runtimeId: 'mac-runtime',
    threadId: 'dory-deployment',
  }
  expect(resolveMarkdownLink(reference)).toBe(reference)
  expect(parseStudioLink(reference)).toEqual(target)
  expect(parseStudioLink(studioNavigationURL(reference)!)).toEqual(target)
  expect(resolveMarkdownLink('studio:local:browser:tab')).toBeUndefined()
  expect(resolveMarkdownLink('studio:local:thread:\u0000')).toBeUndefined()
})
