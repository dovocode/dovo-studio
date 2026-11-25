import { expect, it } from 'vite-plus/test'
import { botTemplateText, fillFromBotTemplate } from './bot-template.js'

it('fills a new draft using saved Bot text and preserves any text already entered', () => {
  const bot = {
    role: 'Release manager',
    responsibilities: 'Review release notes',
    backupAgentId: 'private-id',
  }
  const text = botTemplateText('Release helper', bot)
  expect(JSON.parse(text)).toEqual({
    version: 1,
    name: 'Release helper',
    role: bot.role,
    responsibilities: bot.responsibilities,
  })
  const draft = { name: 'My helper', role: '', responsibilities: 'Keep mine' }
  expect(fillFromBotTemplate(text, draft)).toEqual({ ...draft, role: bot.role })
  expect(() =>
    fillFromBotTemplate(JSON.stringify({ ...JSON.parse(text), backupAgentId: 'id' }), draft),
  ).toThrow('Paste a valid Dovo Bot template.')
})
