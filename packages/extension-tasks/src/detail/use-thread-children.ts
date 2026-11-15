import { useWorkspace } from '@dovo/studio-core'
import { threadChildren } from '@dovo/protocol'

/** Read metadata from the connected computers. Conversation history stays lazy. */
export function useThreadChildren(parentId: string) {
  const { workspace, snapshot, activeRuntimeId, runtimes } = useWorkspace()
  return threadChildren(
    [
      { runtimeId: activeRuntimeId, runtimeIdentity: snapshot?.runtimeId, tasks: workspace.tasks },
      ...(runtimes ?? []).flatMap((source) =>
        source.profile.id !== activeRuntimeId && source.snapshot
          ? [
              {
                runtimeId: source.profile.id,
                runtimeIdentity: source.snapshot.runtimeId,
                tasks: source.snapshot.workspace.tasks,
              },
            ]
          : [],
      ),
    ],
    { id: parentId, runtimeId: activeRuntimeId, runtimeIdentity: snapshot?.runtimeId },
  )
}
