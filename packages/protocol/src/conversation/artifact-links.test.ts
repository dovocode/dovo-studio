import { expect, it } from 'vitest'
import { externalArtifactLinks } from './artifact-links'

it('gathers named Claude artifacts and ChatGPT Sites from Markdown and prose, once per link', () => {
  expect(
    externalArtifactLinks([
      '[Design review](https://claude.ai/code/artifact/code-id?version=2#comments)',
      'Again: https://claude.ai/code/artifact/code-id/.',
      '<https://claude.ai/public/artifacts/public-id>',
      '[Dashboard](<https://metrics.workspace.chatgpt.site/>).',
      'The dashboard: https://metrics.workspace.chatgpt.site/#summary',
    ]),
  ).toEqual([
    { provider: 'claude', title: 'Design review', url: 'https://claude.ai/code/artifact/code-id' },
    {
      provider: 'claude',
      title: 'Claude artifact · public-id',
      url: 'https://claude.ai/public/artifacts/public-id',
    },
    { provider: 'chatgpt', title: 'Dashboard', url: 'https://metrics.workspace.chatgpt.site/' },
  ])
})
it('reads nested MCP result JSON and Sites custom domains with their returned title', () => {
  expect(
    externalArtifactLinks([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: 'site-id',
              slug: 'dashboard',
              title: 'Sales dashboard',
              latest_version_number: 3,
              current_live_url: 'https://dashboard.example.com/',
              current_preview_url: 'https://preview.chatgpt.site/',
              expected_url: 'https://sales.chatgpt.site/',
            }),
          },
        ],
      },
      {
        structuredContent: {
          result: { content: [{ text: 'https://claude.ai/artifacts/private-id' }] },
        },
      },
      '{bad JSON, but https://fallback.chatgpt.site/ is still a link}',
    ]),
  ).toEqual([
    { provider: 'chatgpt', title: 'Sales dashboard', url: 'https://dashboard.example.com/' },
    {
      provider: 'claude',
      title: 'Claude artifact · private-id',
      url: 'https://claude.ai/artifacts/private-id',
    },
    { provider: 'chatgpt', title: 'fallback.chatgpt.site', url: 'https://fallback.chatgpt.site/' },
  ])
})
it('excludes ordinary conversations, gallery links, lookalike domains and credential URLs', () => {
  expect(
    externalArtifactLinks([
      'https://claude.ai/chat/thread https://claude.ai/artifacts https://claude.ai/code/artifacts',
      'https://chatgpt.com/c/thread https://chatgpt.site https://chatgpt.site.evil.com/',
      'https://evilclaude.ai/public/artifacts/id https://example.com/dashboard',
      'https://user:secret@demo.chatgpt.site https://user@claude.ai/code/artifact/id',
      { current_live_url: 'https://ordinary.example.com/' },
    ]),
  ).toEqual([])
})
