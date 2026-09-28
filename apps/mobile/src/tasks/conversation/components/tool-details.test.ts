import { describe, expect, it } from 'vite-plus/test'
import { toolPresentation as toolDetails } from '@dovo/protocol'
describe('Readable tool details', () => {
  it('extracts commands and output without protocol envelopes', () => {
    expect(
      toolDetails(
        JSON.stringify({
          event: {
            item: { type: 'commandExecution', command: 'git status', aggregatedOutput: 'clean' },
          },
        }),
        'Command',
      ),
    ).toEqual({ title: 'git status', input: 'git status', output: 'clean', kind: 'command' })
  })
  it('reads Claude result blocks and ACP content', () => {
    expect(
      toolDetails(
        JSON.stringify({
          event: {
            message: {
              content: [{ type: 'tool_result', content: [{ type: 'text', text: 'Found it' }] }],
            },
          },
        }),
        'Read',
      ).output,
    ).toBe('Found it')
    expect(
      toolDetails(
        JSON.stringify({
          event: {
            update: { content: [{ type: 'content', content: { type: 'text', text: 'Updated' } }] },
          },
        }),
        'Edit',
      ).output,
    ).toBe('Updated')
  })
  it('keeps legacy plain output readable', () => {
    expect(toolDetails('Old output', 'Command').output).toBe('Old output')
  })
  it('handles missing output and shows changed paths', () => {
    expect(toolDetails('{}', 'Tool').output).toBe('')
    expect(
      toolDetails(JSON.stringify({ event: { item: { changes: [{ path: 'app.ts' }] } } }), 'Changes')
        .output,
    ).toBe('app.ts')
  })
})
