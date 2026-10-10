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
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { serviceResult } from './effect.js'
import { overviewWorkspace, scopedWorkspace } from './snapshot-overview.js'
import { discoverProjectIcon } from '../../scm/repositories/project-icon.js'
import { desktopAppUpdateInfo, canUpdateDesktop } from '../desktop-updates.js'
import { canUpdateServer } from '../server-updates.js'
import { readLastCrash } from '../../storage/last-crash.js'
export function runtimeSnapshot(
  s: Services,
  device: { id: string; owner: boolean },
  overview = false,
  taskIds?: readonly string[],
  pagedHistory = false,
) {
  return Effect.gen(function* () {
    const migrated = migrateProjectIcons(s.defaults.get(), s.store.get().repositories, {
      updatedAt: Date.now(),
      changeId: randomUUID(),
    })
    if (migrated) s.defaults.save(migrated, false)
    const revision = s.store.version()
    const storedWorkspace = s.store.publicWorkspace()
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
    return yield* serviceResult({
      ...(taskIds ? { detailTaskIds: [...taskIds] } : {}),
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      runtimeInstanceId: s.instanceId,
      lastCrash: readLastCrash(s.db.name),
      runtimeHost: hostname(),
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
      settingsScopesSupported: true,
      taskBehaviorSupported: true,
      worktreeDeletionOverrideSupported: true,
      artifactsEnabled: s.preferences.get().enableArtifacts,
      acpInstallations: s.acpInstallations.list(),
      revision,
      workspace: {
        ...(taskIds
          ? scopedWorkspace(workspace, taskIds, pagedHistory)
          : overview
            ? overviewWorkspace(workspace)
            : workspace),
        repositories: yield* Effect.forEach(
          workspace.repositories,
          (storedRepository) =>
            Effect.gen(function* () {
              const binding = storedRepository.forge
              const connection = binding && forgeConnections.get(binding.connectionId)
              const repo = {
                ...storedRepository,
                pullIdentity:
                  connection && binding
                    ? forgePullIdentity(connection, binding.repository)
                    : undefined,
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
        ),
      },
      approvals: s.approvals.list(),
      questions: s.questions.list(),
      terminals: s.terminals.list(),
      runs: s.jobs.list(),
      devices: device.owner ? s.devices.list() : s.devices.list().filter((d) => d.id === device.id),
      pendingDevices: device.owner ? s.pairing.pending() : [],
      owner: device.owner,
    } satisfies RuntimeSnapshot)
  })
}
