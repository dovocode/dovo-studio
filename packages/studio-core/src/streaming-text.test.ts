import { expect, it } from 'vite-plus/test'
import { completedStreamingText } from './streaming-text'
it('holds partial paragraphs and unfinished code, preserving complete preceding text', () => {
  expect(completedStreamingText('First paragraph')).toBe('')
  expect(completedStreamingText('First.\n\nPartial')).toBe('First.\n\n')
  expect(completedStreamingText('First.\n\n```ts\nconst x = 1\n\n')).toBe('First.\n\n')
  expect(completedStreamingText('```ts\nconst x = 1\n```\nPartial')).toBe(
    '```ts\nconst x = 1\n```\n',
  )
  expect(completedStreamingText('~~~~ts\n```\n\n~~~~\n')).toBe('~~~~ts\n```\n\n~~~~\n')
})
