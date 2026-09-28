import { expect, it } from 'vitest'
import { taskTranscript } from './task-transcript.js'

it('writes sent messages as Markdown and skips empty replies', () => {
  expect(
    taskTranscript({
      title: 'Fix login',
      messages: [
        {
          id: '1',
          role: 'user',
          text: 'Why does login redirect twice?',
          attachments: [{ id: 'a', name: 'trace.txt', mime: 'text/plain', size: 10 }],
        },
        { id: '2', role: 'assistant', text: '' },
        { id: '3', role: 'assistant', text: 'The guard runs twice.\n\n```ts\nguard()\n```' },
      ],
    }),
  ).toBe(
    [
      '# Fix login',
      '**You**\n\nWhy does login redirect twice?\n\n_Attached: trace.txt_',
      '**Agent**\n\nThe guard runs twice.\n\n```ts\nguard()\n```',
    ].join('\n\n---\n\n') + '\n',
  )
})
