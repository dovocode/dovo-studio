import { useEffect, useRef } from 'react'
import { useStudioHost, useWorkspace, useSettingsTarget } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { SettingsScopePage, TaskBehaviorSettings } from '@dovo/studio-ui'

function ComputerDefaultsLink() {
  const host = useStudioHost()
  const { activeRuntimeId } = useWorkspace()
  return (
    <Button
      variant="link"
      onClick={() =>
        host.navigate({ viewId: 'running-tasks', entityId: activeRuntimeId ?? undefined })
      }
    >
      Open computer running-task defaults
    </Button>
  )
}
export default function TaskBehaviorView({ entityId }: { entityId?: string }) {
  const applied = useRef<string | undefined>(undefined)
  const { setTarget } = useSettingsTarget()
  useEffect(() => {
    if (entityId && applied.current !== entityId) {
      applied.current = entityId
      setTarget({ environmentId: entityId, projectId: '' })
    }
  }, [entityId, setTarget])
  return (
    <SettingsScopePage
      title="Task lifecycle"
      description="Recovery, settling and archiving for new and existing tasks."
    >
      {({ scope, repository }) => (
        <>
          <p className="text-xs text-muted-foreground">
            Project on computer overrides Project, then Computer, then shared defaults. Restart and
            PR settling fall back to the computer defaults when all levels inherit. Archiving falls
            back to the computer’s inactivity policy when no scoped rule is set.
          </p>
          <ComputerDefaultsLink />
          <TaskBehaviorSettings scope={scope} repository={repository} />
        </>
      )}
    </SettingsScopePage>
  )
}
