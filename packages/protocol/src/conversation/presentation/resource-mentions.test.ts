import { expect, it } from 'vitest'
import {
  composerMention,
  insertPrompt,
  mentionedResources,
  promptSuggestions,
  resourceSuggestions,
} from './resource-mentions.js'
import type { ResourceSettings } from '../../shared/resources.js'

const resources = {
  skills: [
    { name: 'release-notes', description: 'Write notes', enabled: false, content: 'Steps' },
    { name: 'review', description: 'Review code', enabled: true, content: 'Check' },
  ],
  mcpServers: [
    { name: 'linear', enabled: true, transport: 'http', url: 'https://mcp.example' },
    { name: 'figma', enabled: false, transport: 'http', url: 'https://mcp.example' },
  ],
} as unknown as ResourceSettings

it('detects the mention being typed for each trigger', () => {
  expect(composerMention('Use $rev', 8)).toEqual({ trigger: '$', start: 4, query: 'rev' })
  expect(composerMention('/rel', 4)).toEqual({ trigger: '/', start: 0, query: 'rel' })
  expect(composerMention('line\n  /re', 10)).toEqual({ trigger: '/', start: 7, query: 're' })
  expect(composerMention('see src/app', 11)).toBeUndefined()
  expect(composerMention('costs $5', 8)).toEqual({ trigger: '$', start: 6, query: '5' })
  expect(composerMention('ask @lin', 8)).toEqual({ trigger: '@', start: 4, query: 'lin' })
})

it('suggests skills for $ and / and only enabled MCP servers for @', () => {
  expect(resourceSuggestions(resources, '$', '').map((item) => item.name)).toEqual([
    'review',
    'release-notes',
  ])
  expect(resourceSuggestions(resources, '/', 'rel').map((item) => item.name)).toEqual([
    'release-notes',
  ])
  expect(resourceSuggestions(resources, '@', '').map((item) => item.name)).toEqual(['linear'])
})

it('finds the skills and servers a message names', () => {
  const found = mentionedResources(
    '/release-notes for v2, check with @linear. Not $reviewer',
    resources,
  )
  expect(found.skills.map((skill) => skill.name)).toEqual(['release-notes'])
  expect(found.mcpServers.map((server) => server.name)).toEqual(['linear'])
  expect(mentionedResources('email me@linear.app about @figma', resources).mcpServers).toEqual([])
})

it('offers saved prompts for # and inserts their text', () => {
  const prompts = [
    { id: '1', name: 'bugfix', text: 'Reproduce first, then fix with a test.' },
    { id: '2', name: 'docs', text: 'Update the docs for this change.' },
  ]
  expect(composerMention('Please #bu', 10)).toEqual({ trigger: '#', start: 7, query: 'bu' })
  expect(promptSuggestions(prompts, 'bu').map((prompt) => prompt.id)).toEqual(['1'])
  expect(promptSuggestions(prompts, 'test').map((prompt) => prompt.id)).toEqual(['1'])
  expect(insertPrompt('Please #bu now', 7, 10, 'Fix it.')).toEqual({
    text: 'Please Fix it. now',
    caret: 14,
  })
})
