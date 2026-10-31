import { expect, it } from 'vite-plus/test'
import { markdownImages } from './markdown-images'
it('preserves empty and ordinary streamed text', () => {
  for (const text of ['', 'Plain text', '[link](https://example.com)', 'unfinished !'])
    expect(markdownImages(text)).toEqual([{ kind: 'text', text, offset: 0 }])
})
it('handles incomplete image syntax and references as they stream', () => {
  for (const text of ['![', '![Shot]', '![Shot](', '![Shot][ref]', '![Shot][ref]\n\n[ref]:'])
    expect(markdownImages(text)).toEqual([{ kind: 'text', text, offset: 0 }])
  expect(markdownImages('![Shot][ref]\n\n[ref]: /image.png')).toEqual([
    { kind: 'image', url: '/image.png', alt: 'Shot', offset: 0 },
    { kind: 'text', text: '\n\n[ref]: /image.png', offset: 12 },
  ])
})
it('extracts server paths and reference images while preserving surrounding text', () => {
  expect(markdownImages('Before\n![Shot](</tmp/a b.png>)\nAfter')).toEqual([
    { kind: 'text', text: 'Before\n', offset: 0 },
    { kind: 'image', url: '/tmp/a b.png', alt: 'Shot', offset: 7 },
    { kind: 'text', text: '\nAfter', offset: 30 },
  ])
  expect(markdownImages('![Shot][shot]\n\n[shot]: ./screenshot.png')[0]).toMatchObject({
    kind: 'image',
    url: './screenshot.png',
  })
})
it('does not treat code examples or escaped syntax as images', () => {
  for (const text of [
    '```md\n![Shot](/tmp/a.png)\n```',
    '```md\n![Shot](/tmp/a.png)',
    '\\![Shot](/tmp/a.png)',
    '`![Shot](/tmp/a.png)`',
  ])
    expect(markdownImages(text)).toEqual([{ kind: 'text', text, offset: 0 }])
})

it('extracts linked images without leaving broken link markup', () => {
  expect(markdownImages('[![Shot](/tmp/a.png)](https://example.com)')).toEqual([
    { kind: 'image', url: '/tmp/a.png', alt: 'Shot', offset: 0 },
  ])
})
