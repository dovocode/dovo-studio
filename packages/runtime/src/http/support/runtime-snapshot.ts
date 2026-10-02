import { hostname } from 'node:os'
import { Effect } from 'effect'
import { RUNTIME_PROTOCOL_VERSION, type RuntimeSnapshot } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { serviceResult } from './effect.js'
import { overviewWorkspace } from './snapshot-overview.js'
import { discoverProjectIcon } from '../../scm/repositories/project-icon.js'
import { desktopAppUpdateInfo, canUpdateDesktop } from '../desktop-updates.js'
import { canUpdateServer } from '../server-updates.js'
export function runtimeSnapshot(
  s: Services,
  device: { id: string; owner: boolean },
  overview = false,
) {
  return Effect.gen(function* () {
    const revision = s.store.version()
    const storedWorkspace = s.store.publicWorkspace()
    const scratch = yield* serviceResult(s.scratch.available())
    const workspace =
      scratch && !storedWorkspace.repositories.some((repo) => repo.id === scratch.id)
        ? { ...storedWorkspace, repositories: [...storedWorkspace.repositories, scratch] }
        : storedWorkspace
    return yield* serviceResult({
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      runtimeInstanceId: s.instanceId,
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
      defaults: s.defaults.get(),
      acpInstallations: s.acpInstallations.list(),
      revision,
      workspace: {
        ...(overview ? overviewWorkspace(workspace) : workspace),
        repositories: yield* Effect.forEach(
          workspace.repositories,
          (repo) =>
            Effect.gen(function* () {
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
                Effect.map((gitIdentity) => ({
                  ...repo,
                  discoveredIcon,
                  gitIdentity,
                  gitIdentityError: undefined,
                })),
                Effect.catchAll(() =>
                  Effect.succeed({
                    ...repo,
                    discoveredIcon,
                    gitIdentity: undefined,
                    gitIdentityError: 'Checkout unavailable: could not inspect its Git remote',
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
