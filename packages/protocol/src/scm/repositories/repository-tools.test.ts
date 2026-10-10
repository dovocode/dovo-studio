import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema'
import {
  repositoryOpenTargetsSchema,
  isRepositoryOpenTarget,
  openRepositorySchema,
} from './repository-tools'
it('keeps known Open in choices when a newer runtime reports an unsupported editor', () => {
  const result = decode(repositoryOpenTargetsSchema, {
    targets: ['finder', 'future-editor', 'vscode'],
  })
  expect(result.targets.filter(isRepositoryOpenTarget)).toEqual(['finder', 'vscode'])
  expect(() => decode(openRepositorySchema, { target: 'future-editor' })).toThrow(
    /target: Expected/,
  )
})
