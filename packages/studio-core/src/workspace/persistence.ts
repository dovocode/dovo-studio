import { decode } from '@dovo/protocol'
import { workspaceSchema, type Workspace } from './schema'
export const storageKey = 'dovo.workspace.v1'
export function decodeWorkspace(value: string): Workspace {
  const workspace = decode(workspaceSchema, JSON.parse(value))
  return {
    ...workspace,
    tasks: workspace.tasks.filter((task) => !task.example),
  }
}
export function encodeWorkspace(value: Workspace): string {
  return JSON.stringify(decode(workspaceSchema, value))
}
