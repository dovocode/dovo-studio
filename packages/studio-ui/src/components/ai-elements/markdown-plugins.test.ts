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
        '## Review\n\n[Setup](docs/setup.md) · [Checklist](#testing)\n\n[Unsafe](javascript:alert(1))\n\n<script>alert("unsafe")</script>',
    }),
  )
  expect(html).toContain('href="https://github.com/dovo/studio/blob/abc123/docs/setup.md"')
  expect(html).toContain('href="https://github.com/dovo/studio/pull/7#testing"')
  expect(html).toContain('data-streamdown="heading-2"')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('<script>')
})
