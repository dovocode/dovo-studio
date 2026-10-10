import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'
import { SettingsSelect } from './settings-select'

export default function PullRequestSettings() {
  const preferences = useAppPreferences()
  return (
    <SettingsPage
      local
      title="Pull requests"
      description="Defaults for creating and merging pull requests from this device."
    >
      <SettingsGroup title="Creating and merging">
        <SettingRow
          label="Create pull requests as drafts"
          description="Preselect Draft when your code host supports it. You can change this for each pull request."
        >
          <Toggle
            label="Create pull requests as drafts"
            checked={preferences.pullDraft}
            onChange={(pullDraft) => updateAppPreferences({ pullDraft })}
          />
        </SettingRow>
        <SettingRow
          label="Merge method"
          description="Preselect this method when merging. If unavailable, use the code host’s default."
        >
          <SettingsSelect
            label="Merge method"
            value={preferences.mergeMethod}
            options={[
              ['auto', 'Code host default'],
              ['merge', 'Merge commit'],
              ['squash', 'Squash and merge'],
              ['rebase', 'Rebase and merge'],
            ]}
            onChange={(mergeMethod) => updateAppPreferences({ mergeMethod })}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
