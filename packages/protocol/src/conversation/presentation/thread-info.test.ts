import { expect, it } from 'vite-plus/test'
import { moveThreadInfoSection, orderedThreadInfoSections, threadInfoSections } from './thread-info'

it('keeps saved order, ignores duplicate/removed keys and appends new sections', () => {
  const sections = orderedThreadInfoSections(['usage', 'removed', 'project', 'usage'])
  expect(sections.slice(0, 2).map((section) => section.id)).toEqual(['usage', 'project'])
  expect(new Set(sections.map((section) => section.id)).size).toBe(threadInfoSections.length)
  expect(sections).toHaveLength(threadInfoSections.length)
})
it('reorders sections without dropping hidden or desktop-only preferences', () => {
  const before = orderedThreadInfoSections().map((section) => section.id)
  const moved = moveThreadInfoSection(before, 'scripts', -1, true)
  expect(moved.indexOf('scripts')).toBeLessThan(moved.indexOf('project'))
  expect(moved).toContain('openIn')
  expect(moveThreadInfoSection(before, 'sharing', -1)).toEqual(before)
  expect(moveThreadInfoSection(before, 'usage', 1)).toEqual(before)
})
