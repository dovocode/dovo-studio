import { Disclosure } from '@dovo/studio-ui'
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
      className="px-0"
      onClick={() =>
        host.navigate({ viewId: 'running-tasks', entityId: activeRuntimeId ?? undefined })
      }
    >
      Open computer running-thread defaults
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
      title="Thread lifecycle"
      description="Recovery, settling and archiving for new and existing threads."
    >
      {({ scope, repository }) => (
        <>
          <Disclosure title="How inherited lifecycle rules work">
            <p className="mt-2">
              Project on computer overrides Project, then Computer, then shared defaults. Restart
              and PR settling fall back to the computer defaults when all levels inherit. Archiving
              falls back to the computer’s inactivity policy when no scoped rule is set.
            </p>
          </Disclosure>
          <ComputerDefaultsLink />
          <TaskBehaviorSettings scope={scope} repository={repository} />
        </>
      )}
    </SettingsScopePage>
  )
}
