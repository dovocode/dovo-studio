import { expect, it } from 'vite-plus/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultProblemReportInclude } from '@dovo/protocol'
import { ReportProblemFields, ReportProblemPreviewView } from './report-problem-view'

it('asks what happened first and includes only versions by default', () => {
  const html = renderToStaticMarkup(
    createElement(ReportProblemFields, {
      form: { description: '', expected: '', include: defaultProblemReportInclude },
      onChange: () => {},
      disabled: false,
      clientErrors: 3,
      timelineSupported: true,
    }),
  )
  expect(html.indexOf('What happened? (required)')).toBeLessThan(
    html.indexOf('What did you expect? (optional)'),
  )
  expect(html).toContain('aria-required="true"')
  for (const label of [
    'App and runtime versions',
    'Runtime diagnostics and logs',
    'Recent app errors (3)',
    'Recent app actions',
  ])
    expect(html).toContain(label)
  expect(html.match(/role="checkbox"[^>]*aria-checked="true"/g)).toHaveLength(1)
  expect(html.match(/role="checkbox"[^>]*aria-checked="false"/g)).toHaveLength(3)

  const optedIn = renderToStaticMarkup(
    createElement(ReportProblemFields, {
      form: {
        description: 'Sync stops',
        expected: '',
        include: { ...defaultProblemReportInclude, diagnostics: true },
      },
      onChange: () => {},
      disabled: false,
      clientErrors: 0,
    }),
  )
  expect(optedIn.match(/aria-checked="true"/g)).toHaveLength(2)
})

it('previews the exact message and attached file with its size and hidden values', () => {
  const html = renderToStaticMarkup(
    createElement(ReportProblemPreviewView, {
      preview: {
        message: 'I want to report a problem in Dovo Studio.\nDo not file the issue yourself.',
        attachment: {
          name: 'dovo-diagnostics.md',
          text: '# Dovo problem report\n- Source commit: 4c481d9817385ece0a0cba127e4a65b2794f80ca\nAuthorization: [redacted]',
          bytes: 2048,
        },
        redactions: 4,
      },
    }),
  )
  expect(html).toContain('The runtime hid 4 values')
  expect(html).toContain('Do not file the issue yourself.')
  expect(html).toContain('Attached file: dovo-diagnostics.md · 2.0 KB')
  expect(html).toContain('Source commit: 4c481d9817385ece0a0cba127e4a65b2794f80ca')
  expect(html).toContain('Authorization: [redacted]')

  const bare = renderToStaticMarkup(
    createElement(ReportProblemPreviewView, {
      preview: { message: 'Only the message', redactions: 0 },
    }),
  )
  expect(bare).toContain('No file is attached.')
  expect(bare).toContain('found no credentials')
})
