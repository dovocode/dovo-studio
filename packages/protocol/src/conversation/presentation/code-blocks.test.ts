import { expect, it } from 'vitest'
import { codeBlockLabel, fencedCodeBlocks, shellCommand } from './code-blocks.js'

it('extracts fenced blocks with their language and ignores inline code', () => {
  const text = [
    'Run `pnpm test` first.',
    '```ts',
    'const a = 1',
    '',
    'const b = 2',
    '```',
    'Then:',
    '~~~~sh',
    'pnpm build',
    '```',
    'still inside the tilde fence',
    '~~~~',
  ].join('\n')
  expect(fencedCodeBlocks(text)).toEqual([
    { language: 'ts', code: 'const a = 1\n\nconst b = 2' },
    { language: 'sh', code: 'pnpm build\n```\nstill inside the tilde fence' },
  ])
})

it('keeps an unclosed block from a streaming reply and skips empty ones', () => {
  expect(fencedCodeBlocks('```\n\n```\n```py\nprint(1)')).toEqual([
    { language: 'py', code: 'print(1)' },
  ])
  expect(fencedCodeBlocks('Windows\r\n```\r\nline\r\n```')).toEqual([
    { language: '', code: 'line' },
  ])
})

it('labels blocks for a chooser', () => {
  expect(codeBlockLabel({ language: '', code: '\n  echo hi\nmore' }, 1)).toBe('Block 2: echo hi')
  expect(codeBlockLabel({ language: 'ts', code: 'x'.repeat(40) }, 0)).toBe(`ts: ${'x'.repeat(31)}…`)
})

it('finds runnable shell blocks and strips console prompts and output', () => {
  expect(shellCommand({ language: 'bash', code: 'pnpm install\npnpm test' })).toBe(
    'pnpm install\npnpm test',
  )
  expect(shellCommand({ language: 'console', code: '$ git status\nOn branch main\n$ ls' })).toBe(
    'git status\nls',
  )
  expect(shellCommand({ language: '', code: '$ echo hi\nhi' })).toBe('echo hi')
  expect(shellCommand({ language: 'ts', code: 'const a = 1' })).toBeUndefined()
  expect(shellCommand({ language: '', code: 'plain text' })).toBeUndefined()
})
