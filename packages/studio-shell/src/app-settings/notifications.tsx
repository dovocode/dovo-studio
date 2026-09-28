import { useApplicationState } from '@dovo/studio-core/state'
import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'

export default function NotificationSettings() {
  const preferences = useAppPreferences()
  const [notice, setNotice] = useApplicationState('')
  // Turning on a notification asks the OS for permission once.
  const notify = async (
    key: 'notifyInput' | 'notifyDone' | 'notifyAutomations',
    enabled: boolean,
  ) => {
    setNotice('')
    if (enabled) {
      if (typeof Notification === 'undefined') {
        setNotice('Notifications are unavailable on this device.')
        return
      }
      if (Notification.permission !== 'granted') {
        try {
          const permission = await Notification.requestPermission()
          if (permission !== 'granted') {
            setNotice(
              'Notifications are blocked. Allow Dovo Studio in your system notification settings.',
            )
            return
          }
        } catch {
          setNotice('Could not request notification permission. Try again in your system settings.')
          return
        }
      }
    }
    updateAppPreferences({ [key]: enabled })
  }
  return (
    <SettingsPage
      title="Notifications"
      description="Alerts while Dovo is in the background on this device."
    >
      <SettingsGroup title="Tasks and automations">
        <SettingRow
          label="When a task needs your input"
          description="A question or approval is waiting while Dovo is in the background."
        >
          <Toggle
            label="Notify when a task needs your input"
            checked={preferences.notifyInput}
            onChange={(enabled) => void notify('notifyInput', enabled)}
          />
        </SettingRow>
        <SettingRow
          label="When a task finishes"
          description="Includes tasks that stop with an error."
        >
          <Toggle
            label="Notify when a task finishes"
            checked={preferences.notifyDone}
            onChange={(enabled) => void notify('notifyDone', enabled)}
          />
        </SettingRow>
        <SettingRow
          label="When an automation finishes"
          description="Also when a run fails or reaches a review step. Cancelled runs stay quiet."
        >
          <Toggle
            label="Notify when an automation finishes"
            checked={preferences.notifyAutomations}
            onChange={(enabled) => void notify('notifyAutomations', enabled)}
          />
        </SettingRow>
        <SettingRow label="Play a sound">
          <Toggle
            label="Play a sound with notifications"
            checked={preferences.notifySound}
            onChange={(notifySound) => updateAppPreferences({ notifySound })}
          />
        </SettingRow>
      </SettingsGroup>
      {notice && (
        <p role="alert" className="text-xs text-destructive">
          {notice}
        </p>
      )}
    </SettingsPage>
  )
}
