import { expect, it } from 'vite-plus/test'
import { insertMention, mentionQuery, rankPaths } from './file-mentions.js'

it('finds the mention being typed and ignores e-mail addresses', () => {
  expect(mentionQuery('Look at @src/ma', 15)).toEqual({ start: 8, query: 'src/ma' })
  expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
  expect(mentionQuery('mail me@example.com', 19)).toBeUndefined()
  expect(mentionQuery('@done and more', 14)).toBeUndefined()
})

it('inserts the chosen path in place of the query', () => {
  expect(insertMention('Fix @comp please', 4, 9, 'src/composer.tsx')).toEqual({
    text: 'Fix @src/composer.tsx  please',
    caret: 22,
  })
})

it('ranks file-name matches first and supports letters in order', () => {
  const paths = [
    'docs/composer-guide.md',
    'src/chat/composer.tsx',
    'src/composer/index.ts',
    'src/chat/thread.tsx',
  ]
  expect(rankPaths(paths, 'composer')).toEqual([
    'src/chat/composer.tsx',
    'docs/composer-guide.md',
    'src/composer/index.ts',
  ])
  expect(rankPaths(paths, 'cthr')).toEqual(['src/chat/thread.tsx'])
  expect(rankPaths(paths, '', 2)).toEqual(['src/chat/thread.tsx', 'src/chat/composer.tsx'])
})

it('keeps the best matches even when they occur late in a large catalog', () => {
  const paths = Array.from({ length: 10_000 }, (_, index) => `archive/component-${index}/index.ts`)
  paths.push('z/component.ts', 'a/component.ts', 'component.ts')
  expect(rankPaths(paths, 'component', 3)).toEqual([
    'component.ts',
    'a/component.ts',
    'z/component.ts',
  ])
  expect(rankPaths([...paths].reverse(), 'component', 3)).toEqual(rankPaths(paths, 'component', 3))
})

it('preserves score and alphabetical ordering across result limits', () => {
  const paths = ['ab.ts', 'ab.ts', 'folder/ab.ts', 'folder/cab.ts', 'a/b/file.ts', 'missing.ts']
  for (const query of ['', 'ab', 'AB', 'fbf', 'no-match']) {
    const all = rankPaths(paths, query, paths.length)
    for (const limit of [0, 1, 2, 4, 20])
      expect(rankPaths(paths, query, limit)).toEqual(all.slice(0, limit))
  }
})
