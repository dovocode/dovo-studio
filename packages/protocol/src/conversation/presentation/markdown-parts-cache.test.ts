import { expect, it, vi } from 'vite-plus/test'
import { cachedMarkdownParts } from './markdown-parts-cache.js'
import { richMarkdown } from './rich-markdown.js'

it('reuses completed results per local-file mode and matches uncached output', () => {
  const split = vi.fn<typeof richMarkdown>(richMarkdown)
  const parts = cachedMarkdownParts(split)
  const text = 'Intro\n\n[Report](reports/q3.pdf)\n\n![Shot](shot.png)\n\nDone 👋'
  const first = parts(text, true)
  expect(first).toEqual(richMarkdown(text, true))
  expect(parts(text, true)).toBe(first)
  expect(split).toHaveBeenCalledTimes(1)
  const remote = parts(text, false)
  expect(remote).toEqual(richMarkdown(text, false))
  expect(remote).not.toEqual(first)
  expect(split).toHaveBeenCalledTimes(2)
  expect(parts(text, false)).toBe(remote)
  expect(split).toHaveBeenCalledTimes(2)
})

it('never retains streaming prefixes', () => {
  const split = vi.fn<typeof richMarkdown>(richMarkdown)
  const parts = cachedMarkdownParts(split)
  const text = 'Partial [file](src/a.ts'
  parts(text, true, true)
  parts(text, true, true)
  expect(split).toHaveBeenCalledTimes(2)
  const completed = parts(text, true)
  expect(parts(text, true)).toBe(completed)
  expect(split).toHaveBeenCalledTimes(3)
})

it('bounds entries and bytes, refreshes recent entries and skips oversized results', () => {
  const split = vi.fn<(text: string) => { kind: string; text: string; offset: number }[]>(
    (text) => [{ kind: 'markdown', text, offset: 0 }],
  )
  const parts = cachedMarkdownParts(split, { budget: 2000, limit: 2 })
  const one = parts('one', true)
  parts('two', true)
  expect(parts('one', true)).toBe(one)
  parts('three', true)
  expect(split).toHaveBeenCalledTimes(3)
  // "two" was least recently used, so it was evicted by the entry limit.
  parts('two', true)
  expect(split).toHaveBeenCalledTimes(4)
  parts('two', true)
  expect(split).toHaveBeenCalledTimes(4)
  // Above a quarter of the byte budget: returned, never cached and never evicts others.
  const large = 'x'.repeat(200)
  parts(large, true)
  parts(large, true)
  expect(split).toHaveBeenCalledTimes(6)
  parts('two', true)
  expect(split).toHaveBeenCalledTimes(6)
  // Several mid-size entries evict by byte budget before reaching the entry limit.
  const bytes = cachedMarkdownParts(split, { budget: 2000, limit: 100 })
  const sized = ['a', 'b', 'c', 'd', 'e'].map((letter) => letter.repeat(60))
  for (const text of sized) bytes(text, true)
  const calls = split.mock.calls.length
  bytes(sized[0]!, true)
  expect(split).toHaveBeenCalledTimes(calls + 1)
  bytes(sized[4]!, true)
  expect(split).toHaveBeenCalledTimes(calls + 1)
})

it('freezes shared cached parts, including nested templates, but not private streaming output', () => {
  const parts = cachedMarkdownParts(richMarkdown)
  const text =
    'Pick one:\n\n::artifact-template{artifact_kind="site" display_name="Landing page" skill_name="artifact-template-site" skill_directory="/tmp/skills/site"}'
  const cached = parts(text, true)
  const template = cached.find((part) => part.kind === 'template')
  expect(template?.kind === 'template' && template.template.name).toBe('Landing page')
  for (const value of [
    cached,
    cached[0],
    template,
    template?.kind === 'template' && template.template,
  ])
    expect(Object.isFrozen(value)).toBe(true)
  expect(() => (cached as unknown as unknown[]).push({})).toThrow(TypeError)
  expect(() => Object.assign(cached[0]!, { offset: 99 })).toThrow(TypeError)
  expect(parts(text, true)).toEqual(richMarkdown(text, true))
  expect(Object.isFrozen(parts(text, true, true))).toBe(false)
})
