import { expect, it } from 'vite-plus/test'
import { parsePiTranscript } from './session-transcript.js'

const transcript = (...entries: unknown[]) =>
  entries.map((entry) => JSON.stringify(entry)).join('\n')
const header = { type: 'session', version: 3, id: 'session', cwd: '/project' }

it('imports only the active branch, retaining links through non-conversation entries', () => {
  const result = parsePiTranscript(
    transcript(
      header,
      { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'Question' } },
      {
        type: 'message',
        id: 'b',
        parentId: 'a',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Abandoned' }] },
      },
      { type: 'message', id: 'c', parentId: 'a', message: { role: 'toolResult', content: null } },
      {
        type: 'message',
        id: 'd',
        parentId: 'c',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hidden' },
            { type: 'text', text: 'Answer' },
          ],
        },
      },
      { type: 'session_info', id: 'e', parentId: 'd', name: 'Named session' },
    ),
  )
  expect(result.messages.map((message) => message.text)).toEqual(['Question', 'Answer'])
  expect(result.title).toBe('Named session')
})

it('supports linear sessions and rejects broken branch links', () => {
  expect(
    parsePiTranscript(
      transcript(header, { type: 'message', message: { role: 'user', content: 'Old' } }),
    ).messages[0]?.text,
  ).toBe('Old')
  expect(() =>
    parsePiTranscript(transcript(header, { type: 'message', id: 'a', parentId: 'missing' })),
  ).toThrow('missing branch links')
})
