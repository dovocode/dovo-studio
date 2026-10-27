import { enabledStudioTools } from '@dovo/protocol'
import { settledSummaryPage } from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { Effect } from 'effect'
import {
  forgePullIdentity,
  sharedProjectIcon,
  migrateProjectIcons,
  RUNTIME_PROTOCOL_VERSION,
  runtimeDefaultsSchema,
  decode,
  type RuntimeSnapshot,
  type Workspace,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { serviceResult } from './effect.js'
import { snapshotWorkspace, pagedSummaryTask } from './snapshot-overview.js'
import { discoverProjectIcon } from '../../scm/repositories/project-icon.js'
import { desktopAppUpdateInfo, canUpdateDesktop } from '../desktop-updates.js'
import { canUpdateServer } from '../server-updates.js'
import { readLastCrash } from '../../storage/last-crash.js'
import { modelCatalogGenerations } from '../../agents/catalogs/model-cache.js'
const projections = new WeakMap<
  Services,
  { source: WeakRef<Workspace>; workspace: WeakRef<Workspace> }
>()
function sameRepository(
  a: Workspace['repositories'][number],
  b: Workspace['repositories'][number],
) {
  const entries: [string, unknown][] = Object.entries(a).filter(([, value]) => value !== undefined)
  return (
    entries.length === Object.values(b).filter((value) => value !== undefined).length &&
    entries.every(([key, value]) => Object.hasOwn(b, key) && value === Reflect.get(b, key))
  )
}
/** Derived Git/forge/icon fields can change independently of the stored workspace.
 * Reconcile them on every refresh, but reuse the immutable projection while unchanged. */
function projectWorkspace(
  services: Services,
  source: Workspace,
  repositories: Workspace['repositories'],
): Workspace {
  const previous = projections.get(services)
  const previousSource = previous?.source.deref()
  const previousWorkspace = previous?.workspace.deref()
  const items = repositories.map((repository, index) => {
    const before = previousWorkspace?.repositories[index] ?? source.repositories[index]
    return before && sameRepository(before, repository) ? before : repository
  })
  const priorRepositories = previousWorkspace?.repositories ?? source.repositories
  const stableRepositories =
    items.length === priorRepositories.length &&
    items.every((repository, index) => repository === priorRepositories[index])
      ? priorRepositories
      : items
  if (previousSource === source && stableRepositories === previousWorkspace?.repositories)
    return previousWorkspace
  const workspace =
    stableRepositories === source.repositories
      ? source
      : { ...source, repositories: stableRepositories }
  projections.set(services, { source: new WeakRef(source), workspace: new WeakRef(workspace) })
  return workspace
}
const settledPages = new WeakMap<
  Workspace,
  Map<string, { workspace: Workspace; omitted: number; expires: number }>
>()
function pagedWorkspace(workspace: Workspace, limit: number, selected: readonly string[] = []) {
  const key = JSON.stringify([limit, [...selected].sort()])
  let pages = settledPages.get(workspace)
  const previous = pages?.get(key)
  const now = Date.now()
  if (previous && now < previous.expires) return previous
  const page = settledSummaryPage(workspace.tasks, limit, selected, now)
  const expires = workspace.tasks.reduce((expiry, task) => {
    const until = task.snoozedUntil ? Date.parse(task.snoozedUntil) : 0
    return until > now ? Math.min(expiry, until) : expiry
  }, Infinity)
  const value = {
    workspace: page.omitted ? { ...workspace, tasks: page.tasks } : workspace,
    omitted: page.omitted,
    expires,
  }
  if (!pages) settledPages.set(workspace, (pages = new Map()))
  pages.set(key, value)
  if (pages.size > 16) {
    const first = pages.keys().next().value
    if (first !== undefined) pages.delete(first)
  }
  return value
}
export function runtimeSnapshot(
  s: Services,
  device: { id: string; owner: boolean },
  overview = false,
  taskIds?: readonly string[],
  pagedHistory = false,
  settledLimit?: number,
) {
  return Effect.gen(function* () {
    const migrated = migrateProjectIcons(s.defaults.get(), s.store.get().repositories, {
      updatedAt: Date.now(),
      changeId: randomUUID(),
    })
    if (migrated) s.defaults.save(migrated, false)
    const revision = s.store.version()
    const preferences = s.preferences.get()
    const acpInstallations = s.acpInstallations.list()
    const catalogGenerations = modelCatalogGenerations(s.agents, acpInstallations)
    // Capture the wire view before asynchronous repository enrichment, at this revision.
    const completeWorkspace = snapshotWorkspace(
      s.store.publicWorkspace(),
      {
        publicTask: (id) => s.store.publicTask(id),
        publicCompleteTasks: (reuse) => s.store.publicCompleteTasks(reuse),
        publicPagedTask: (summary) => {
          const page = s.store.historyPage(summary.id)
          if (!page) throw new Error(`History for ${summary.id} could not be read.`)
          return pagedSummaryTask(s.db, summary, page)
        },
      },
      {
        overview,
        taskIds,
        pagedHistory,
      },
    )
    const page =
      settledLimit === undefined
        ? undefined
        : pagedWorkspace(completeWorkspace, settledLimit, [
            ...(taskIds ?? []),
            ...s.approvals.list().map((request) => request.taskId),
            ...s.questions.list().map((request) => request.taskId),
          ])
    const storedWorkspace = page?.workspace ?? completeWorkspace
    const forgeConnections = new Map(
      storedWorkspace.repositories.some((repository) => repository.forge)
        ? s.forges.list().map((connection) => [connection.id, connection] as const)
        : [],
    )
    const scratch = yield* serviceResult(s.scratch.available())
    const workspace =
      scratch && !storedWorkspace.repositories.some((repo) => repo.id === scratch.id)
        ? { ...storedWorkspace, repositories: [...storedWorkspace.repositories, scratch] }
        : storedWorkspace
    const repositories = yield* Effect.forEach(
      workspace.repositories,
      (storedRepository) =>
        Effect.gen(function* () {
          const binding = storedRepository.forge
          const connection = binding && forgeConnections.get(binding.connectionId)
          const repo = {
            ...storedRepository,
            pullIdentity:
              connection && binding ? forgePullIdentity(connection, binding.repository) : undefined,
          }
          if (repo.kind === 'scratch')
            return { ...repo, gitIdentity: undefined, gitIdentityError: undefined }
          const discoveredIcon = yield* serviceResult(discoverProjectIcon(repo.path))
          // Never block the snapshot on spawning git: use the last known identity and
          // refresh it in the background. Unknown identity is not an error, it is pending.
          if (repo.kind === 'folder')
            return {
              ...repo,
              discoveredIcon,
              gitIdentity: undefined,
              gitIdentityError: undefined,
            }
          const cached = s.git.cachedRepositoryIdentity(repo.path)
          if (!cached)
            return {
              ...repo,
              discoveredIcon,
              gitIdentity: undefined,
              gitIdentityError: undefined,
            }
          return yield* serviceResult(cached).pipe(
            Effect.map((gitIdentity) => {
              if (repo.gitIdentity !== gitIdentity)
                s.store.update((workspace) => ({
                  ...workspace,
                  repositories: workspace.repositories.map((item) =>
                    item.id === repo.id ? { ...item, gitIdentity } : item,
                  ),
                }))
              return {
                ...repo,
                discoveredIcon,
                gitIdentity,
                iconOverride: sharedProjectIcon(s.defaults.get(), { ...repo, gitIdentity }),
                gitIdentityError: undefined,
              }
            }),
            Effect.catch(() =>
              Effect.sync(() => {
                if (repo.gitIdentity)
                  s.store.update((workspace) => ({
                    ...workspace,
                    repositories: workspace.repositories.map((item) =>
                      item.id === repo.id ? { ...item, gitIdentity: undefined } : item,
                    ),
                  }))
                return {
                  ...repo,
                  discoveredIcon,
                  gitIdentity: undefined,
                  gitIdentityError: 'Checkout unavailable: could not inspect its Git remote',
                }
              }),
            ),
          )
        }),
      { concurrency: 4 },
    )
    const enrichedWorkspace = projectWorkspace(s, storedWorkspace, repositories)
    const selectedWorkspace = enrichedWorkspace
    return yield* serviceResult({
      ...(taskIds ? { detailTaskIds: [...taskIds] } : {}),
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      runtimeInstanceId: s.instanceId,
      runtimeId: s.runtimeId,
      catalogGenerations,
      runtimeAddresses: s.runtimeAddresses(),
      lastCrash: readLastCrash(s.db.name),
      runtimeHost: hostname(),
      runtimeIcon: preferences.runtimeIcon,
      sshAddress: preferences.sshAddress,
      releaseVersion: process.env.DOVO_RELEASE_VERSION || undefined,
      desktopApp: desktopAppUpdateInfo(),
      releaseDistribution:
        process.env.DOVO_RELEASE_DISTRIBUTION === 'desktop'
          ? 'desktop'
          : process.env.DOVO_SERVER_DISTRIBUTION === 'archive'
            ? 'archive'
            : 'source',
      releaseCanUpdate:
        process.env.DOVO_RELEASE_DISTRIBUTION === 'desktop'
          ? canUpdateDesktop()
          : canUpdateServer(),
      defaults: decode(runtimeDefaultsSchema, s.store.publicValue(s.defaults.get())),
      scopedAgentsSupported: true,
      permissionPolicySupported: true,
      workspaceReconciliationSupported: true,
      taskListUndoSupported: true,
      threadServersSupported: process.platform === 'linux' || process.platform === 'darwin',
      settingsScopesSupported: true,
      taskBehaviorSupported: true,
      threadBehaviorSupported: true,
      queuedTurnSettingsSupported: true,
      fullTurnSettingsSupported: true,
      persistentTurnModelsSupported: true,
      projectTransfersSupported: true,
      projectWorktreeTransfersSupported: true,
      projectTransfers: s.projectTransfers.list(),
      worktreeDeletionOverrideSupported: true,
      studioTools: enabledStudioTools(preferences),
      remoteDesktopEnabled: preferences.enableRemoteDesktop,
      remoteDesktopSession: s.remoteDesktop.status(),
      artifactsEnabled: preferences.enableArtifacts,
      codeReviewsEnabled: preferences.enableCodeReviews,
      autoProjectModelSelection: preferences.autoProjectModelSelection,
      smartModelSelectionEnabled: preferences.enableSmartModelSelection,
      autoProjectSelectionEnabled: preferences.enableAutoProjectSelection,
      allowWebRequests: preferences.allowWebRequests,
      acpInstallations,
      revision,
      ...(page && settledLimit !== undefined
        ? { olderSettled: { limit: settledLimit, omitted: page.omitted } }
        : {}),
      workspace: selectedWorkspace,
      approvals: s.approvals.list(),
      questions: s.questions.list().filter((question) => question.routing !== 'parent'),
      terminals: s.terminals.list(),
      runs: s.jobs.list(),
      devices: device.owner ? s.devices.list() : s.devices.list().filter((d) => d.id === device.id),
      peerUpgradeSupported: true,
      internet: s.peers.internet.status(),
      internetSetupSupported: !s.peers.internet.contains(device.id),
      relaySettings: s.peers.relay.status(),
      relaySetupSupported: !s.peers.internet.contains(device.id),
      pendingPeerUpgrades: device.owner ? s.peers.upgrades.pending() : [],
      pendingDevices: device.owner ? s.pairing.pending() : [],
      owner: device.owner,
    } satisfies RuntimeSnapshot)
  })
}
