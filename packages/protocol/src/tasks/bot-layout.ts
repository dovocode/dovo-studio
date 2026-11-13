import { Schema } from 'effect'

export const botLayouts = [
  { id: 'horizontal', name: 'Horizontal row' },
  { id: 'grid-2', name: '2 columns' },
  { id: 'grid-3', name: '3 columns' },
  { id: 'rows', name: 'Rows' },
] as const
export const botLayoutSchema = Schema.Literals(botLayouts.map(({ id }) => id))
export type BotLayout = typeof botLayoutSchema.Type
export const isBotLayout = (value: string): value is BotLayout =>
  botLayouts.some(({ id }) => id === value)
