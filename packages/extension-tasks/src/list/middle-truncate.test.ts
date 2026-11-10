import { expect, it } from 'vite-plus/test'
import { splitForMiddleTruncate } from './middle-truncate'

it.each([
  ['feature/ui-polish', 'ui-polish'],
  ['t3/clone-repo-to-other-machine', 'machine'],
  ['t3/investigate-release-build-times', 'times'],
  ['t3/compare-long-featurenames-ab', 'featurenames-ab'],
  ['t3/abcdefghijklmnopqrstuvwxyz', 'qrstuvwxyz'],
  ['dovo/look-further-into-t3-opportunities-ece7c019', 'ece7c019'],
])('keeps T3’s word-aligned suffix for %s', (value, tail) => {
  const split = splitForMiddleTruncate(value)
  expect(split?.tail).toBe(tail)
  expect(split && split.head + split.tail).toBe(value)
})

it('keeps short branch names whole', () => {
  expect(splitForMiddleTruncate('main')).toBeNull()
  expect(splitForMiddleTruncate('fix/ui')).toBeNull()
})

it('keeps Unicode code points intact when splitting a long branch', () => {
  const value = 'feature/' + '🚀'.repeat(19)
  expect(splitForMiddleTruncate(value)).toEqual({
    head: 'feature/' + '🚀'.repeat(9),
    tail: '🚀'.repeat(10),
  })
})
