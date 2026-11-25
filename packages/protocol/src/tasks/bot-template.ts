import { Schema } from 'effect'
import { botResponsibilitiesSchema, botRoleSchema } from './bots.js'
import { decode, maxValue, strictStruct } from '../shared/schema.js'

const templateSchema = strictStruct({
  version: Schema.Literal(1),
  name: maxValue(Schema.String, 1024).check(Schema.isPattern(/\S/)),
  role: botRoleSchema,
  responsibilities: botResponsibilitiesSchema,
})
type BotText = Omit<typeof templateSchema.Type, 'version'>
export const botTemplateTextLimit = 60_000

export function botTemplateText(name: string, { role, responsibilities }: Omit<BotText, 'name'>) {
  return JSON.stringify(
    decode(templateSchema, { version: 1, name, role, responsibilities }),
    null,
    2,
  )
}

export function fillFromBotTemplate(text: string, draft: BotText): BotText {
  let template: typeof templateSchema.Type
  try {
    if (text.length > botTemplateTextLimit) throw new Error()
    template = decode(templateSchema, JSON.parse(text))
  } catch {
    throw new Error('Paste a valid Dovo Bot template.')
  }
  return {
    name: draft.name.trim() ? draft.name : template.name,
    role: draft.role.trim() ? draft.role : template.role,
    responsibilities: draft.responsibilities.trim()
      ? draft.responsibilities
      : template.responsibilities,
  }
}
