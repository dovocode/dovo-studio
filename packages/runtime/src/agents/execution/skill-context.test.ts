import { expect, it } from 'vite-plus/test'
import { skillContext } from './skill-context.js'

const skill = {
  name: 'deploy',
  description: 'Deploy a service',
  content: 'Private instructions'.repeat(1000),
  sourcePath: '/skills/deploy/SKILL.md',
}
it('advertises skill discovery without injecting bodies into each system prompt', () => {
  const catalog = skillContext([skill], true)
  expect(catalog).toContain('skill_read')
  expect(catalog).toContain('deploy: Deploy a service')
  expect(catalog).not.toContain(skill.content)
  expect(catalog.length).toBeLessThan(400)
  expect(skillContext([], true)).toBe('')
})
it('preserves complete instructions and supporting paths when scoped tools are unavailable', () => {
  const inline = skillContext([skill], false)
  expect(inline).toContain(skill.content)
  expect(inline).toContain(skill.sourcePath)
})

it.each([20, 40])('bounds catalogs with %s merged skills with maximum descriptions', (count) => {
  const skills = Array.from({ length: count }, (_, i) => ({
    ...skill,
    name: String(i).padEnd(80, 'a'),
    description: 'x'.repeat(2000),
  }))
  const catalog = skillContext(skills, true)
  expect(catalog.length).toBeLessThanOrEqual(9500)
  for (const entry of skills) expect(catalog).toContain(entry.name)
  expect(catalog).toContain('full description in skill_read')
})
