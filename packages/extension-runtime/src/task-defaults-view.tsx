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
      description="Defaults for new tasks, agent configuration and saved prompts."
    >
      {({ scope, repository }) => (
        <TaskDefaultSettings inline repository={repository} scope={scope} />
      )}
    </SettingsScopePage>
  )
}
