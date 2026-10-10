import { useState } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'

function NotificationSettingsRows() {
  const preferences = useAppPreferences()
  const [notice, setNotice] = useApplicationState('')
  const [requesting, setRequesting] = useState(false)
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
        setRequesting(true)
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
        } finally {
          setRequesting(false)
        }
      }
    }
    updateAppPreferences({ [key]: enabled })
  }
  return (
    <>
      <SettingsGroup title="Inside Dovo">
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
      </SettingsGroup>
      <SettingsGroup
        title="System notifications"
        description="Alerts while Dovo is in the background. Enabling an alert requests permission from your device."
      >
        <SettingRow
          label="When a task needs your input"
          description="A question or approval is waiting while Dovo is in the background."
        >
          <Toggle
            label="Notify when a task needs your input"
            disabled={requesting}
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
            disabled={requesting}
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
            disabled={requesting}
            checked={preferences.notifyAutomations}
            onChange={(enabled) => void notify('notifyAutomations', enabled)}
          />
        </SettingRow>
      </SettingsGroup>
      {requesting && (
        <p role="status" className="text-xs text-muted-foreground">
          Waiting for notification permission…
        </p>
      )}
      {notice && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
        >
          {notice}
        </p>
      )}
      <SettingsGroup title="Preview & sound">
        <SettingRow
          label="Quick input preview"
          description="On desktop, show questions and approvals over other apps while Dovo is inactive. Includes connected computers."
        >
          <Toggle
            label="Show quick input preview"
            checked={preferences.inputPreview}
            onChange={(inputPreview) => updateAppPreferences({ inputPreview })}
          />
        </SettingRow>
        <SettingRow label="Play a sound" description="Play a sound when Dovo sends a notification.">
          <Toggle
            label="Play a sound with notifications"
            checked={preferences.notifySound}
            onChange={(notifySound) => updateAppPreferences({ notifySound })}
          />
        </SettingRow>
      </SettingsGroup>
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
