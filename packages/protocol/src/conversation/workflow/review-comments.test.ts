import { expect, it } from 'vitest'
import { pendingReviewComments, reviewCommentsPrompt } from './review-comments.js'

it('lists review comments the agent has not received yet', () => {
  const comment = (id: string) => ({
    id,
    role: 'user' as const,
    text: `comment ${id}`,
    file: 'a.ts',
  })
  const task = {
    messages: [
      comment('sent'),
      { id: 'plain', role: 'user' as const, text: 'hello' },
      comment('in-flight'),
      comment('waiting'),
    ],
    consumedMessageIds: ['sent'],
    runAttempt: { inputMessageIds: ['in-flight'], promptAccepted: false },
  }
  expect(pendingReviewComments(task).map((message) => message.id)).toEqual(['waiting'])
  expect(reviewCommentsPrompt(1)).toBe('Please address my review comment above.')
  expect(reviewCommentsPrompt(3)).toBe('Please address my 3 review comments above.')
})
