import { expect, it } from 'vite-plus/test'
import { activePlugins, decode, mergeResources, resourceSettingsSchema } from '../index.js'

const formatter = 'formatter@gh-0123456789ab:claude'
const notes = 'notes@gh-0123456789ab:claude'

it('resolves the computer default, then later scopes by name', () => {
  const installed = [
    { id: formatter, enabled: false },
    { id: notes, enabled: true },
  ]
  expect(activePlugins(installed, {})).toEqual([notes])
  const group = mergeResources(undefined, {
    mcpServers: [],
    skills: [],
    plugins: [{ name: formatter, enabled: true }],
  })
  expect(activePlugins(installed, group)).toEqual([formatter, notes])
  const project = mergeResources(group, {
    mcpServers: [],
    skills: [],
    plugins: [
      { name: formatter, enabled: false },
      { name: notes, enabled: false },
    ],
  })
  expect(activePlugins(installed, project)).toEqual([])
  // A choice for a plugin that is not installed here has no effect.
  expect(activePlugins([], group)).toEqual([])
})

it('rejects scoped Codex activations and duplicate names', () => {
  const resources = (plugins: unknown) => ({ mcpServers: [], skills: [], plugins })
  expect(() =>
    decode(
      resourceSettingsSchema,
      resources([{ name: 'notes@gh-0123456789ab:codex', enabled: true }]),
    ),
  ).toThrow('Codex turns plugins on for the whole computer')
  expect(() =>
    decode(
      resourceSettingsSchema,
      resources([
        { name: formatter, enabled: true },
        { name: formatter, enabled: false },
      ]),
    ),
  ).toThrow('Names must be unique')
  expect(mergeResources({ mcpServers: [], skills: [] }).plugins).toBeUndefined()
})
