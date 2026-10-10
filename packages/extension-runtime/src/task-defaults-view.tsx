import { useEffect } from 'react'
import { useSettingsTarget } from '@dovo/studio-core'
import { TaskDefaultSettings, TaskBehaviorSettings, SettingsScopePage } from '@dovo/studio-ui'

export default function TaskDefaultsView({ entityId }: { entityId?: string }) {
  const { setTarget } = useSettingsTarget()
  useEffect(() => {
    if (entityId) setTarget({ environmentId: entityId, projectId: '' })
  }, [entityId, setTarget])
  return (
    <SettingsScopePage
      title="Task defaults"
      description="Choose how tasks start, prepare their workspace and continue over time."
    >
      {({ scope, repository }) => (
        <>
          <TaskDefaultSettings inline repository={repository} scope={scope} />
          <TaskBehaviorSettings scope={scope} repository={repository} />
        </>
      )}
    </SettingsScopePage>
  )
}
