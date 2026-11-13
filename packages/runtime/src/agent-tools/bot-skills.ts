import { createHash, randomUUID } from 'node:crypto'
import { createTwoFilesPatch } from 'diff'
import { isDeepStrictEqual } from 'node:util'
import {
  botSkillProposalInputSchema,
  botSkillDecisionSchema,
  decode,
  emptyBotResources,
  botResourcesSchema,
  redactCredentialText,
  botSchema,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
const receipt = (botId: string, key: string) =>
  `bot-skill-proposal:${botId}:${createHash('sha256').update(key).digest('hex')}`
export function proposeBotSkill(s: Services, taskId: string, value: unknown) {
  const input = decode(botSkillProposalInputSchema, value)
  const task = s.store.taskSummary(taskId)
  if (!task.bot || task.replica || task.archivedAt)
    throw new HttpError(403, 'Only this computer’s Bot coordinator can propose a skill.')
  const existing = s.db
    .prepare('SELECT value FROM documents WHERE id=?')
    .pluck()
    .get(receipt(taskId, input.key))
  if (typeof existing === 'string') return { id: existing }
  const source = s.store.taskSummary(input.sourceTaskId)
  const owned =
    source.id === taskId ||
    source.delegation?.parentTaskId === taskId ||
    source.botJob?.botId === taskId
  if (
    !owned ||
    !s.store
      .task(source.id)
      .turns?.some((turn) => turn.id === input.sourceTurnId && turn.status === 'completed')
  )
    throw new HttpError(409, 'Choose a completed turn from this Bot or one of its workers.')
  const text = [input.name, input.description, input.content].join('\n')
  if (
    redactCredentialText(text) !== text ||
    /-----BEGIN|\b(password|api[ _-]?key|secret|access[ _-]?token)\s*[:=]\s*\S+/i.test(text)
  )
    throw new HttpError(400, 'Remove credentials and secrets from the skill proposal.')
  const before = task.bot.resources?.skills.find((skill) => skill.name === input.name)
  const skill = {
    name: input.name,
    description: input.description,
    content: input.content,
    enabled: true,
  }
  const patch = createTwoFilesPatch(
    input.name + '/SKILL.md',
    input.name + '/SKILL.md',
    before?.content ?? '',
    input.content,
  )
  const proposal = {
    id: randomUUID(),
    sourceTaskId: source.id,
    sourceTurnId: input.sourceTurnId,
    skill,
    before,
    patch,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  }
  if ((task.bot.skillProposals?.filter((p) => p.status === 'pending').length ?? 0) >= 10)
    throw new HttpError(
      409,
      'This Bot has ten saved proposals. Review or reject proposals before adding another.',
    )
  s.store.transaction(() => {
    s.store.updateTask(taskId, (t) => ({
      ...t,
      bot: t.bot && {
        ...t.bot,
        revision: randomUUID(),
        updatedAt: new Date().toISOString(),
        skillProposals: [
          ...(t.bot.skillProposals ?? []).filter(
            (p, index, all) =>
              all.length < 10 ||
              p.status === 'pending' ||
              index !== all.findIndex((old) => old.status !== 'pending'),
          ),
          proposal,
        ],
      },
    }))
    s.db.prepare('INSERT INTO documents VALUES (?,?)').run(receipt(taskId, input.key), proposal.id)
  })
  return { id: proposal.id }
}
export function decideBotSkill(s: Services, value: unknown) {
  const input = decode(botSkillDecisionSchema, value)
  const task = s.store.taskSummary(input.id),
    bot = task.bot
  if (!bot || task.replica || task.archivedAt) throw new HttpError(404, 'Bot not found.')
  const proposal = bot.skillProposals?.find((p) => p.id === input.proposalId)
  if (!proposal) throw new HttpError(404, 'Skill proposal not found.')
  const status = input.accept ? 'applied' : 'rejected'
  if (proposal.status === status)
    return { id: task.id, bot: decode(botSchema, s.store.publicValue(bot)) }
  if (proposal.status !== 'pending' || bot.revision !== input.expectedRevision)
    throw new HttpError(409, 'The Bot changed. Review its current skill proposal before saving.')
  const resources = bot.resources ?? emptyBotResources()
  if (
    input.accept &&
    !isDeepStrictEqual(
      resources.skills.find((skill) => skill.name === proposal.skill.name),
      proposal.before,
    )
  )
    throw new HttpError(409, 'The skill changed. Reject this proposal and prepare a new diff.')
  const next = input.accept
    ? decode(botResourcesSchema, {
        ...resources,
        skills: [
          ...resources.skills.filter((skill) => skill.name !== proposal.skill.name),
          proposal.skill,
        ],
      })
    : resources
  s.store.updateTask(task.id, (t) => ({
    ...t,
    bot: t.bot && {
      ...t.bot,
      resources: next,
      updatedAt: new Date().toISOString(),
      revision: randomUUID(),
      skillProposals: t.bot.skillProposals?.map((p) =>
        p.id === proposal.id ? { ...p, status } : p,
      ),
    },
  }))
  return {
    id: task.id,
    bot: decode(botSchema, s.store.publicValue(s.store.taskSummary(task.id).bot)),
  }
}
