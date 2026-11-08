import { Disclosure } from '@dovo/studio-ui'
import { useEffect, useRef } from 'react'
import { useStudioHost, useWorkspace, useSettingsTarget } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { SettingsScopePage, TaskBehaviorSettings } from '@dovo/studio-ui'

function ComputerDefaultsLinks() {
  const host = useStudioHost()
  const { activeRuntimeId } = useWorkspace()
  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Button
          variant="link"
          className="px-0"
          onClick={() =>
            host.navigate({ viewId: 'running-tasks', entityId: activeRuntimeId ?? undefined })
          }
        >
          Restart & archiving defaults
        </Button>
        <Button
          variant="link"
          className="px-0"
          onClick={() =>
            host.navigate({
              viewId: 'pull-request-monitoring-settings',
              entityId: activeRuntimeId ?? undefined,
            })
          }
        >
          PR settling defaults
        </Button>
      </div>
    </div>
  )
}
export default function TaskBehaviorView({ entityId }: { entityId?: string }) {
  const host = useStudioHost()
  const applied = useRef<string | undefined>(undefined)
  const { setTarget } = useSettingsTarget()
  useEffect(() => {
    if (entityId && applied.current !== entityId) {
      let active = true
      void setTarget({ environmentId: entityId, projectId: '' }).then((accepted) => {
        if (active && accepted) applied.current = entityId
      })
      return () => {
        active = false
      }
    }
  }, [entityId, setTarget])
  return (
    <SettingsScopePage
      title="Thread lifecycle"
      description="Recovery, settling and archiving for new and existing threads."
      supportsEditing={(snapshot) => snapshot?.taskBehaviorSupported === true}
      saveInfo="Edits apply after saving."
      offlineRecovery
    >
      {({ scope, repository }) => (
        <>
          <Disclosure title="How inherited lifecycle rules work">
            <p className="mt-2">
              Project on computer overrides Project, then Computer, then shared defaults. Restart
              and PR settling fall back to the computer defaults when all levels inherit. Archiving
              falls back to the computer’s inactivity policy when no scoped rule is set.
            </p>
            <ComputerDefaultsLinks />
          </Disclosure>
          <TaskBehaviorSettings
            scope={scope}
            repository={repository}
            onOpenRuntime={() => host.navigate({ viewId: 'runtime' })}
          />
        </>
      )}
    </SettingsScopePage>
  )
}
