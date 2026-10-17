import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, Toggle, ChoicePicker } from '@dovo/studio-ui'

export function PullRequestCreationDefaults() {
  const preferences = useAppPreferences()
  return (
    <SettingsGroup title="Creating and merging · This device">
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
        <ChoicePicker
          aria-label="Merge method"
          value={preferences.mergeMethod}
          onValueChange={(mergeMethod) => {
            if (
              mergeMethod === 'auto' ||
              mergeMethod === 'merge' ||
              mergeMethod === 'squash' ||
              mergeMethod === 'rebase'
            )
              updateAppPreferences({ mergeMethod })
          }}
        >
          <option value="auto">Code host default</option>
          <option value="merge">Merge commit</option>
          <option value="squash">Squash and merge</option>
          <option value="rebase">Rebase and merge</option>
        </ChoicePicker>
      </SettingRow>
    </SettingsGroup>
  )
}
