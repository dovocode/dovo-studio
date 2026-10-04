import { useApplicationState } from '@dovo/studio-core/state'
import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'

export function NotificationSettingsRows() {
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
    <>
      <SettingsGroup title="Tasks and automations">
        <SettingRow
          label="In-app notifications"
          description="Show an alert when another task finishes, fails or needs input while Dovo has focus."
        >
          <Toggle
            label="In-app notifications"
            checked={preferences.inAppNotifications}
            onChange={(inAppNotifications) => updateAppPreferences({ inAppNotifications })}
          />
        </SettingRow>
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
          label="Quick input preview"
          description="On desktop, show questions and approvals above your other apps while Dovo is inactive, including connected remote servers."
        >
          <Toggle
            label="Show quick input preview"
            checked={preferences.inputPreview}
            onChange={(inputPreview) => updateAppPreferences({ inputPreview })}
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
    </>
  )
}

export default function NotificationSettings() {
  return (
    <SettingsPage
      local
      title="Notifications"
      description="Choose which task events need your attention."
    >
      <NotificationSettingsRows />
    </SettingsPage>
  )
}
