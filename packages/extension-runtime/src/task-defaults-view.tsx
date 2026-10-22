import { useEffect } from 'react'
import { useSettingsTarget } from '@dovo/studio-core'
import { TaskDefaultSettings, SettingsScopePage } from '@dovo/studio-ui'

export default function TaskDefaultsView({ entityId }: { entityId?: string }) {
  const { setTarget } = useSettingsTarget()
  useEffect(() => {
    if (entityId) setTarget({ environmentId: entityId, projectId: '' })
  }, [entityId, setTarget])
  return (
    <SettingsScopePage
      title="Task defaults"
      description="Choose the agent, access and workspace for new tasks."
    >
      {({ scope, repository }) => (
        <TaskDefaultSettings inline repository={repository} scope={scope} />
      )}
    </SettingsScopePage>
  )
}
