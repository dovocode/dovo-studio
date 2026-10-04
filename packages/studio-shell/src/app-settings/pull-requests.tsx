import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Segmented, Toggle } from './layout'

export default function PullRequestSettings() {
  const preferences = useAppPreferences()
  return (
    <SettingsPage
      local
      title="Pull requests"
      description="How this device creates and merges pull requests. Accounts are in Source control."
    >
      <SettingsGroup title="Creating and merging">
        <SettingRow
          label="Create pull requests as drafts"
          description="Preselects Draft when the forge supports it. You can still change it per pull request."
        >
          <Toggle
            label="Create pull requests as drafts"
            checked={preferences.pullDraft}
            onChange={(pullDraft) => updateAppPreferences({ pullDraft })}
          />
        </SettingRow>
        <SettingRow
          label="Merge method"
          description="Preselected when merging. Falls back to the forge’s default if it isn’t offered."
        >
          <Segmented
            label="Merge method"
            value={preferences.mergeMethod}
            options={[
              ['auto', 'Forge default'],
              ['merge', 'Merge'],
              ['squash', 'Squash'],
              ['rebase', 'Rebase'],
            ]}
            onChange={(mergeMethod) => updateAppPreferences({ mergeMethod })}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
