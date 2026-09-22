import { z } from 'zod'
import { runtimeRequest } from './client.js'
import { connectionSchema, snapshotSchema } from './runtime.js'
import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'
import { pullPageSchema } from './pulls.js'
import type { PullSummary } from './pulls.js'
import { pullNeedsAttention } from './pull-presentation.js'
import { isSnoozed } from './task-priority.js'
import type { Task } from './workspace.js'

export function runtimeProfile(connection: RuntimeConnection, name?: string) {
  const parsed = connectionSchema.parse(connection)
  const url = new URL(parsed.address)
  if (['0.0.0.0', '[::]'].includes(url.hostname))
    throw new Error(
      'Use the device’s LAN, Tailscale or NetBird address. A wildcard address is only for binding the server.',
    )
  return {
    id: url.origin,
    name: name?.trim() || url.hostname,
    connection: { ...parsed, address: url.origin },
  }
}
const profileSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    connection: connectionSchema,
  })
  .refine((profile) => {
    try {
      return profile.id === new URL(profile.connection.address).origin
    } catch {
      return false
    }
  }, 'Runtime identity must match its address')
export const runtimeRegistrySchema = z
  .object({
    version: z.literal(1),
    activeId: z.string().nullable(),
    profiles: z.array(profileSchema),
  })
  .refine(
    (registry) =>
      new Set(registry.profiles.map((profile) => profile.id)).size === registry.profiles.length,
    'Runtime addresses must be unique',
  )
  .refine(
    (registry) =>
      registry.activeId === null ||
      registry.profiles.some((profile) => profile.id === registry.activeId),
    'Active runtime must be saved',
  )
export type RuntimeProfile = z.infer<typeof profileSchema>
export type RuntimeRegistry = z.infer<typeof runtimeRegistrySchema>
export function upsertRuntime(
  registry: RuntimeRegistry,
  profile: RuntimeProfile,
  activate = true,
): RuntimeRegistry {
  const normalized = runtimeProfile(profile.connection, profile.name)
  const exists = registry.profiles.some((item) => item.id === normalized.id)
  return {
    version: 1,
    activeId: activate ? normalized.id : registry.activeId,
    profiles: exists
      ? registry.profiles.map((item) => (item.id === normalized.id ? normalized : item))
      : [...registry.profiles, normalized],
  }
}
export function removeRuntime(registry: RuntimeRegistry, id: string): RuntimeRegistry {
  return {
    version: 1,
    activeId: registry.activeId === id ? null : registry.activeId,
    profiles: registry.profiles.filter((profile) => profile.id !== id),
  }
}
export type RuntimeOverview = {
  profile: RuntimeProfile
  snapshot: RuntimeSnapshot | null
  connected: boolean
  lastSeen: string | null
  error: string | null
  pulls: { total: number; needsAttention: number; reviewRequested: number; partial: boolean } | null
  pullError: string | null
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
export async function loadRuntimeOverview(
  profile: RuntimeProfile,
  previous?: RuntimeOverview,
  onSnapshot?: (overview: RuntimeOverview) => void,
): Promise<RuntimeOverview> {
  // Never retain another host's data, including when callers replace a profile.
  const cached =
    previous?.profile.id === profile.id &&
    previous.profile.connection.token === profile.connection.token
      ? previous
      : undefined
  let snapshot: RuntimeSnapshot
  try {
    snapshot = await runtimeRequest(
      profile.connection,
      profile.connection.address,
      '/api/snapshot',
      undefined,
      snapshotSchema,
      'GET',
      10000,
    )
  } catch (error) {
    return {
      profile,
      snapshot: cached?.snapshot ?? null,
      connected: false,
      lastSeen: cached?.lastSeen ?? null,
      error: errorText(error),
      pulls: cached?.pulls ? { ...cached.pulls, partial: true } : null,
      pullError: cached?.pullError ?? null,
    }
  }
  const lastSeen = new Date().toISOString()
  onSnapshot?.({
    profile,
    snapshot,
    connected: true,
    lastSeen,
    error: null,
    pulls: cached?.pulls ?? null,
    pullError: cached?.pullError ?? null,
  })
  const pulls = new Map<string, PullSummary>()
  const errors: string[] = []
  let partial = false
  let loaded = 0
  const repositories = snapshot.workspace.repositories
  // Cached first pages keep this lightweight. Counts explicitly flag incomplete data.
  for (let start = 0; start < repositories.length; start += 3) {
    await Promise.all(
      repositories.slice(start, start + 3).map(async (repository) => {
        try {
          const page = await runtimeRequest(
            profile.connection,
            profile.connection.address,
            '/api/scm/pulls/overview',
            { repositoryId: repository.id, state: 'open', page: 1, refresh: false },
            pullPageSchema,
            'POST',
            15000,
          )
          loaded++
          partial ||= page.hasMore || !!page.stale || !!page.refreshError
          if (page.refreshError) errors.push(`${repository.name}: ${page.refreshError}`)
          for (const pull of page.pulls)
            if (pull.state === 'open') {
              const existing = pulls.get(pull.url)
              if (!existing || existing.updatedAt < pull.updatedAt) pulls.set(pull.url, pull)
            }
        } catch (error) {
          partial = true
          errors.push(`${repository.name}: ${errorText(error)}`)
        }
      }),
    )
  }
  const values = [...pulls.values()]
  return {
    profile,
    snapshot,
    connected: true,
    lastSeen,
    error: null,
    pulls:
      loaded || !repositories.length
        ? {
            total: values.length,
            needsAttention: values.filter(pullNeedsAttention).length,
            reviewRequested: values.filter((pull) => pull.viewerReviewRequested && !pull.draft)
              .length,
            partial,
          }
        : cached?.pulls
          ? { ...cached.pulls, partial: true }
          : null,
    pullError: errors.length ? errors.join('\n') : null,
  }
}
export type RuntimeTask = {
  key: string
  runtimeId: string
  runtimeName: string
  task: Task
  projectName: string
  needsInput: boolean
  online: boolean
}
export function aggregateRuntimeTasks(
  entries: readonly RuntimeOverview[],
  now = Date.now(),
  includeInactive = false,
): RuntimeTask[] {
  const tasks = entries.flatMap((entry) => {
    if (!entry.snapshot) return []
    const { snapshot, profile } = entry
    const needsInput = new Set(
      [...snapshot.approvals, ...snapshot.questions].map((item) => item.taskId),
    )
    const projects = new Map(
      snapshot.workspace.repositories.map((repository) => [repository.id, repository.name]),
    )
    return snapshot.workspace.tasks
      .filter(
        (task) => !task.example && (includeInactive || (!task.archived && !isSnoozed(task, now))),
      )
      .map((task) => ({
        key: JSON.stringify([profile.id, task.id]),
        runtimeId: profile.id,
        runtimeName:
          profile.name !== new URL(profile.connection.address).hostname
            ? profile.name
            : snapshot.runtimeHost || profile.name,
        task,
        projectName: projects.get(task.repositoryId) ?? 'No project',
        needsInput: needsInput.has(task.id),
        online: entry.connected,
      }))
  })
  const priority = (item: RuntimeTask) =>
    item.needsInput ? 0 : item.task.status === 'failed' ? 1 : item.task.status === 'running' ? 2 : 3
  return tasks.sort(
    (a, b) =>
      Number(!!b.task.pinned) - Number(!!a.task.pinned) ||
      priority(a) - priority(b) ||
      (b.task.updatedAt ?? b.task.createdAt).localeCompare(a.task.updatedAt ?? a.task.createdAt) ||
      a.key.localeCompare(b.key),
  )
}
