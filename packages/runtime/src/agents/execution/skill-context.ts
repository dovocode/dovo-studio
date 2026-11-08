import type { RunSkill } from '../../auth/run-credentials.js'

const catalogDescriptionLimit = 320
const catalogCharacterBudget = 9500
const fullDescriptionSuffix = '… (full description in skill_read)'

/** Keep skill bodies out of every turn when scoped reads are available. */
export function skillContext(skills: RunSkill[], scopedReads: boolean): string {
  if (!skills.length) return ''
  const heading = scopedReads
    ? 'Enabled skills (apply when relevant). Call dovo_task skill_read with the exact name before applying a skill; follow its complete instructions and resolve supporting files relative to its source path.'
    : 'Enabled skills for this task (apply when relevant):'
  // Project and agent scopes can each contribute 20 skills. Reserve every name,
  // separator and truncation notice before sharing the remaining description budget.
  const descriptionLimit = Math.min(
    catalogDescriptionLimit,
    Math.max(
      1,
      Math.floor(
        (catalogCharacterBudget -
          heading.length -
          skills.reduce(
            (total, skill) => total + skill.name.length + 6 + fullDescriptionSuffix.length,
            0,
          )) /
          skills.length,
      ),
    ),
  )
  return [
    heading,
    ...skills.map((skill) =>
      scopedReads
        ? `- ${skill.name}: ${skill.description.length > descriptionLimit ? `${skill.description.slice(0, descriptionLimit)}${fullDescriptionSuffix}` : skill.description}`
        : `## ${skill.name}\n${skill.description}\n${skill.sourcePath ? `Skill source (resolve supporting files from its containing folder): ${skill.sourcePath}\n` : ''}${skill.content}`,
    ),
  ].join('\n\n')
}
