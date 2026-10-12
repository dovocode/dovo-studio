import { Schema } from 'effect'

export const runtimeIconSchema = Schema.Literals([
  'desktop',
  'laptop',
  'server',
  'cloud',
  'cpu',
  'terminal',
])
export type RuntimeIcon = Schema.Schema.Type<typeof runtimeIconSchema>
export const runtimeIconChoices = [
  { id: 'desktop', name: 'Desktop' },
  { id: 'laptop', name: 'Laptop' },
  { id: 'server', name: 'Server' },
  { id: 'cloud', name: 'Cloud' },
  { id: 'cpu', name: 'CPU' },
  { id: 'terminal', name: 'Terminal' },
] satisfies Array<{ id: RuntimeIcon; name: string }>
