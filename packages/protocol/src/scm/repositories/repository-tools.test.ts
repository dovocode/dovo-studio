import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema'
import { openRepositorySchema, repositoryOpenTargets } from './repository-tools'

it('accepts Explorer while retaining existing folder and editor targets', () => {
  for (const target of [
    'finder',
    'explorer',
    'file-manager',
    'vscode',
    'vscode-insiders',
    'vscodium',
    'cursor',
    'antigravity',
    'devin',
    'windsurf',
    'zed',
    'webstorm',
    'idea',
    'pycharm',
    'rustrover',
  ])
    expect(decode(openRepositorySchema, { target })).toEqual({ target })
  expect(() => decode(openRepositorySchema, { target: 'arbitrary-command' })).toThrow(
    /finder|explorer/,
  )
})

it('names the connected runtime’s file manager and defaults to older Mac runtimes', () => {
  expect(repositoryOpenTargets('explorer').slice(0, 9)).toEqual([
    ['explorer', 'File Explorer'],
    ['vscode', 'VS Code'],
    ['vscode-insiders', 'VS Code Insiders'],
    ['vscodium', 'VSCodium'],
    ['cursor', 'Cursor'],
    ['antigravity', 'Antigravity'],
    ['devin', 'Devin Desktop'],
    ['windsurf', 'Windsurf'],
    ['zed', 'Zed'],
  ])
  expect(repositoryOpenTargets('file-manager')[0]).toEqual(['file-manager', 'File manager'])
  expect(repositoryOpenTargets('finder')[0]).toEqual(['finder', 'Finder'])
  expect(repositoryOpenTargets()[0]).toEqual(['finder', 'Finder'])
})
