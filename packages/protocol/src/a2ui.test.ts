import { expect, it } from 'vite-plus/test'
import example from '../../../examples/a2ui/issue-picker.json'
import {
  a2uiApplyValues,
  a2uiCatalog,
  a2uiEvent,
  a2uiInputValues,
  a2uiMessages,
  a2uiProcessor,
} from './a2ui'

it('processes real A2UI v1.0 messages, applies typed input and restores a compact snapshot', () => {
  const processor = a2uiProcessor(example.messages)
  try {
    expect(a2uiCatalog.toJson()).toHaveProperty('catalogId')
    const baseline = a2uiMessages(processor)
    const original = structuredClone(baseline)
    a2uiApplyValues(
      processor,
      {
        issues: { '/selected': ['123'], '/instructions': 'Keep my draft', '/includeTests': false },
      },
      true,
    )
    expect(baseline).toEqual(original)
    expect(a2uiEvent(processor, 'issues', 'send')).toMatchObject({
      name: 'selectIssues',
      context: { issues: ['123'], instructions: 'Keep my draft' },
    })
    const restored = a2uiProcessor(a2uiMessages(processor))
    try {
      expect(a2uiInputValues(restored)).toEqual(a2uiInputValues(processor))
    } finally {
      restored.dispose()
    }
  } finally {
    processor.dispose()
  }
})

it('rejects invalid input, required omissions, forged actions and unknown data paths', () => {
  const processor = a2uiProcessor(example.messages)
  try {
    expect(() => a2uiApplyValues(processor, {}, true)).toThrow('required')
    expect(() => a2uiApplyValues(processor, { issues: { '/selected': ['other'] } })).toThrow(
      'valid',
    )
    expect(() => a2uiApplyValues(processor, { issues: { '/includeTests': 'yes' } })).toThrow(
      'boolean',
    )
    expect(() => a2uiApplyValues(processor, { issues: { '/undeclared': 'value' } })).toThrow(
      'Unknown',
    )
    expect(() => a2uiApplyValues(processor, { other: {} })).toThrow('Unknown')
    expect(() => a2uiEvent(processor, 'issues', 'heading')).toThrow('Unknown')
  } finally {
    processor.dispose()
  }
})

it.each([
  { version: '0.8', surfaceUpdate: { surfaceId: 'bad', components: [] } },
  {
    version: '1.0',
    callRendererFunction: {
      surfaceId: 'issues',
      functionCall: { '@call': 'openUrl', args: { url: 'https://example.com' } },
    },
  },
  {
    version: '1.0',
    createSurface: { surfaceId: 'bad', catalogId: 'https://unknown/catalog', components: [] },
  },
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'bad',
      catalogId: a2uiCatalog.id,
      components: [{ id: 'root', component: 'Html', html: '<script>bad()</script>' }],
    },
  },
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'bad',
      catalogId: a2uiCatalog.id,
      components: [{ id: 'root', component: 'Column', children: ['root'] }],
    },
  },
])('rejects unsupported protocols, functions, catalogs, components and cycles', (message) => {
  expect(() => a2uiProcessor([message])).toThrow(/A2UI/)
})
