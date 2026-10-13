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
  it('shows Muse bash, read and edit context', () => {
    expect(
      toolDetails(
        JSON.stringify({
          event: {
            item: {
              kind: 'toolCall',
              tool: 'bash',
              args: JSON.stringify({ command: 'pnpm test', description: 'Run tests' }),
              visibleOutput: 'ok',
            },
          },
        }),
        'bash',
      ),
    ).toMatchObject({ title: 'pnpm test', detail: 'Run tests', kind: 'command' })
    expect(
      toolDetails(
        JSON.stringify({
          event: {
            item: {
              kind: 'toolCall',
              tool: 'read_file',
              args: JSON.stringify({ path: 'src/app.ts' }),
              visibleOutput: 'Read text file `src/app.ts`.\n1|one\n2|two',
            },
          },
        }),
        'read_file',
      ),
    ).toMatchObject({ title: 'Read app.ts', detail: 'src/app.ts · lines 1–2', kind: 'file' })
    expect(
      toolDetails(
        JSON.stringify({
          event: {
            item: {
              kind: 'toolCall',
              tool: 'edit_file',
              args: JSON.stringify({ path: 'src/app.ts', find: 'a', replace: 'b' }),
              patchSummary: { added: 1, files: 1, removed: 1 },
              visibleOutput: 'edited\nchanged lines: line 3\n--- original\n+++ updated\n@@ -1 +1 @@\n-a\n+b',
            },
          },
        }),
        'edit_file',
      ),
    ).toMatchObject({
      title: 'Edit app.ts',
      detail: 'src/app.ts · +1 −1',
      diff: '@@ -1 +1 @@\n-a\n+b',
      kind: 'file',
    })
  })
})
