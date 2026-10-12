import { expect, it } from 'vite-plus/test'
import {
  richMarkdown,
  renderFileCitations,
  richMarkdownPaths,
  markdownMediaKind,
  artifactTemplatePrompt,
} from './rich-markdown'

it('embeds standalone media and file links while keeping surrounding prose', () => {
  const text = 'Before\n[Shot](</tmp/a b.png>)\nAfter\n\n[Movie](clip.mp4)\n\n[Report](report.pdf)'
  expect(richMarkdown(text).filter((part) => part.kind !== 'markdown')).toEqual([
    { kind: 'image', path: '/tmp/a b.png', label: 'Shot', offset: 7 },
    { kind: 'video', path: 'clip.mp4', label: 'Movie', offset: text.indexOf('[Movie]') },
    { kind: 'file', path: 'report.pdf', label: 'Report', offset: text.indexOf('[Report]') },
  ])
  expect(
    richMarkdown(text)
      .filter((part) => part.kind === 'markdown')
      .map((part) => part.text)
      .join(''),
  ).toContain('After')
})
it('preserves prose, nested links, escapes, code and unsupported schemes', () => {
  for (const text of [
    'See [Shot](shot.png) please.',
    '[A](a.png) [B](b.png)',
    '- [Shot](shot.png)',
    '> [Shot](shot.png)',
    '```md\n[Shot](shot.png)\n```',
    '`[Shot](shot.png)`',
    '\\[Shot](shot.png)',
    '[Editor](vscode://foo/a.png)',
    '[Unsafe](javascript:alert(1))',
    '[Shot](shot.png',
  ])
    expect(richMarkdown(text)).toEqual([{ kind: 'markdown', text, offset: 0 }])
})
it('resolves reference media and keeps reference definitions available in split blocks', () => {
  const parts = richMarkdown(
    'See [Docs][docs].\n\n[Shot][shot]\n\nMore [Docs][docs].\n\n[shot]: ./shot.png\n[docs]: https://example.com',
  )
  expect(parts.find((part) => part.kind === 'image')).toMatchObject({ path: './shot.png' })
  expect(
    parts
      .filter((part) => part.kind === 'markdown')
      .every((part) => part.text.includes('[docs]: https://example.com')),
  ).toBe(true)
})
it('retains repository links on non-task surfaces', () => {
  const text = '[Shot](shot.png)\n\n[File](src/app.ts)'
  expect(richMarkdown(text, false)).toEqual([{ kind: 'markdown', text, offset: 0 }])
  expect(markdownMediaKind('https://example.com/clip.mp4?download=1')).toBe('video')
  expect(markdownMediaKind('vscode://file/image.png')).toBeUndefined()
})
it('renders file citations with source ranges and safely encoded paths', () => {
  const text =
    'See :codex-file-citation{path="/tmp/a #b.ts" line_range_start="12" line_range_end="16"}.'
  expect(renderFileCitations(text)).toBe('See [a #b.ts:12–16](</tmp/a %23b.ts#L12>).')
  expect(richMarkdownPaths(text)).toEqual(['/tmp/a #b.ts'])
  const windows = ':codex-file-citation{path="C:\\work\\app.ts" line_range_start="1"}'
  expect(renderFileCitations(windows)).toContain('C:%5Cwork%5Capp.ts#L1')
})
it('leaves malformed citations, nested citations and examples literal', () => {
  for (const text of [
    ':codex-file-citation{}',
    ':codex-file-citation{path="https://example.com"}',
    '` :codex-file-citation{path="/tmp/file"}`',
    '```\n:codex-file-citation{path="/tmp/file"}\n```',
    '[:codex-file-citation{path="/tmp/file"}](https://example.com)',
    ':codex-file-citation{path="/tmp/file"',
  ])
    expect(renderFileCitations(text)).toBe(text)
})
it('renders valid artifact templates without interpreting arbitrary directives', () => {
  const directive =
    '::artifact-template{artifact_kind="site" display_name="Landing page" skill_name="artifact-template-site" skill_directory="/tmp/skills/site"}'
  const parts = richMarkdown('Before\n\n' + directive + '\n\nAfter')
  const part = parts.find((part) => part.kind === 'template')
  expect(part).toMatchObject({
    template: {
      kind: 'site',
      name: 'Landing page',
      skill: 'artifact-template-site',
      directory: '/tmp/skills/site',
    },
  })
  if (part?.kind !== 'template') throw new Error('Expected template card')
  expect(artifactTemplatePrompt(part.template)).toBe(
    'Use $artifact-template-site to create a site about…',
  )
  for (const text of [
    directive.replace('artifact-template-site', 'shell-command'),
    directive.replace('artifact_kind="site"', 'artifact_kind="unknown"'),
    '```\n' + directive + '\n```',
    directive.replace('/tmp/skills/site', 'relative/skill'),
    '::other{foo="bar"}',
  ])
    expect(richMarkdown(text)).toEqual([{ kind: 'markdown', text, offset: 0 }])
})

it('embeds bare media URLs without promoting sentence links or table cells', () => {
  expect(richMarkdown('https://example.com/clip.mp4')[0]).toMatchObject({
    kind: 'video',
    path: 'https://example.com/clip.mp4',
  })
  for (const text of [
    'See https://example.com/clip.mp4.',
    '| Preview |\n| --- |\n| [Shot](shot.png) |',
  ])
    expect(richMarkdown(text)).toEqual([{ kind: 'markdown', text, offset: 0 }])
})
it('renders visualization markers as interactive file previews and registers shared paths', () => {
  const marker =
    '\uE200visualize\uE202{"path":"/tmp/a_b/demo.html","mode":"wide","title":"Review demo"}\uE201'
  const text = `Before\n\n${marker}\n\nAfter`
  expect(richMarkdown(text)).toContainEqual({
    kind: 'visualization',
    path: '/tmp/a_b/demo.html',
    label: 'Review demo',
    wide: true,
    offset: 8,
  })
  expect(richMarkdownPaths(text)).toEqual(['/tmp/a_b/demo.html'])
  expect(richMarkdown(text, false)).toEqual([{ kind: 'markdown', text, offset: 0 }])
})
it('keeps invalid, remote, incomplete and code-example visualization markers literal', () => {
  for (const text of [
    '\uE200visualize\uE202{"path":"https://example.com/demo.html"}\uE201',
    '\uE200visualize\uE202{"path":"/tmp/file.txt"}\uE201',
    '\uE200visualize\uE202{"path":"/tmp/demo.html"',
    '\uE200visualize\uE202not json\uE201',
    '```\n\uE200visualize\uE202{"path":"/tmp/demo.html"}\uE201\n```',
    '`\uE200visualize\uE202{"path":"/tmp/demo.html"}\uE201`',
    '`\n\uE200visualize\uE202{"path":"/tmp/demo.html"}\uE201\n`',
  ]) {
    expect(richMarkdown(text)).toEqual([{ kind: 'markdown', text, offset: 0 }])
    expect(richMarkdownPaths(text)).toEqual([])
  }
})
