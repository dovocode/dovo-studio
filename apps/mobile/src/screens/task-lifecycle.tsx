import { useEffect, useRef } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { ScopedSettings, useOptionalSettingsTarget } from '../runtime/preferences/settings-target'
import { TaskLifecycleSettings } from '../runtime/preferences/task-lifecycle-settings'
import { ScreenHeader } from '../ui/layout/screen-header'
import { SettingsPage } from './settings-theme'

export default function TaskLifecycleScreen() {
  const { runtimeId } = useLocalSearchParams<{ runtimeId?: string }>()
  const applied = useRef<string | undefined>(undefined)
  const selection = useOptionalSettingsTarget()
  const setTarget = selection?.setTarget
  useEffect(() => {
    if (runtimeId && applied.current !== runtimeId) {
      applied.current = runtimeId
      setTarget?.({ environmentId: runtimeId, projectId: '' })
    }
  }, [runtimeId, setTarget])
  return (
    <SettingsPage>
      <ScreenHeader title="Task lifecycle" />
      <ScopedSettings scrollable>
        {({ scope, repository }) => <TaskLifecycleSettings scope={scope} repository={repository} />}
      </ScopedSettings>
    </SettingsPage>
  )
}
