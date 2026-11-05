import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

/** Keep lifecycle overrides on the same computer as the defaults being viewed. */
export function LifecycleLink() {
  const host = useStudioHost()
  const { activeRuntimeId } = useWorkspace()
  return (
    <Button
      variant="link"
      className="px-0"
      onClick={() =>
        host.navigate({ viewId: 'task-behavior', entityId: activeRuntimeId ?? undefined })
      }
    >
      Open scoped thread lifecycle
    </Button>
  )
}
