import { expect, it } from 'vite-plus/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Streamdown } from 'streamdown'
import { markdownPluginsForLinks } from './markdown-plugins'

it('resolves repository links before hardening while retaining Markdown and HTML sanitization', () => {
  const html = renderToStaticMarkup(
    createElement(Streamdown, {
      mode: 'static',
      linkSafety: { enabled: false },
      rehypePlugins: markdownPluginsForLinks(
        'https://github.com/dovo/studio/pull/7',
        'https://github.com/dovo/studio/blob/abc123/',
      ),
      children:
        '## Review\n\n[Setup](docs/setup.md) · [Checklist](#testing)\n\n<strong>Release highlights</strong><ul><li>Improved updates</li></ul>\n\n[Unsafe](javascript:alert(1))\n\n<script>alert("unsafe")</script>',
    }),
  )
  expect(html).toContain('href="https://github.com/dovo/studio/blob/abc123/docs/setup.md"')
  expect(html).toContain('href="https://github.com/dovo/studio/pull/7#testing"')
  expect(html).toContain('data-streamdown="heading-2"')
  expect(html).toContain('data-streamdown="strong">Release highlights</span>')
  expect(html).not.toContain('&lt;strong&gt;')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('<script>')
})

it('renders local chat files before sanitization without allowing script links', () => {
  const html = renderToStaticMarkup(
    createElement(Streamdown, {
      mode: 'static',
      linkSafety: { enabled: false },
      rehypePlugins: markdownPluginsForLinks(undefined, undefined, true),
      children:
        '[Screenshot](</tmp/a b.png>) · [Source](src/app.ts:12) · [File](file:///tmp/report.pdf)\n\n![Image](/tmp/shot.png)\n\n[Unsafe](javascript:alert(1))',
    }),
  )
  expect(html).toContain('https://dovo-local-file.invalid/?path=%2Ftmp%2Fa%2520b.png')
  expect(html).toContain('https://dovo-local-file.invalid/?path=src%2Fapp.ts')
  expect(html).toContain('https://dovo-local-file.invalid/?path=file%3A%2F%2F%2Ftmp%2Freport.pdf')
  expect(html).toContain('https://dovo-local-file.invalid/?path=%2Ftmp%2Fshot.png')
  expect(html).not.toContain('javascript:')
})

it('names read-only task checkboxes from their own Markdown item, excluding nested tasks', () => {
  const html = renderToStaticMarkup(
    createElement(Streamdown, {
      mode: 'static',
      rehypePlugins: markdownPluginsForLinks(),
      children:
        '- [x] Review **desktop** UI\n  - [ ] Check mobile UI\n- [ ] Verify [settings](https://example.com)',
    }),
  )
  const checkboxes = html.match(/<input[^>]+>/g) ?? []
  expect(checkboxes).toHaveLength(3)
  expect(checkboxes[0]).toContain('aria-label="Review desktop UI"')
  expect(checkboxes[0]).toContain('checked=""')
  expect(checkboxes[1]).toContain('aria-label="Check mobile UI"')
  expect(checkboxes[2]).toContain('aria-label="Verify settings"')
  for (const checkbox of checkboxes) expect(checkbox).toContain('disabled=""')
})
