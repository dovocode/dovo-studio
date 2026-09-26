import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Segmented, Toggle } from './layout'

export default function DiffSettings() {
  const preferences = useAppPreferences()
  return (
    <SettingsPage
      title="Diffs"
      description="How changes look in task reviews, turn checkpoints and pull requests. Diffs follow your Appearance theme."
    >
      <SettingsGroup title="Layout">
        <SettingRow
          label="Default layout"
          description="Each diff can still switch between unified and split."
        >
          <Segmented
            label="Default diff layout"
            value={preferences.diffLayout}
            options={[
              ['unified', 'Unified'],
              ['split', 'Split'],
            ]}
            onChange={(diffLayout) => updateAppPreferences({ diffLayout })}
          />
        </SettingRow>
        <SettingRow label="Long lines" description="Wrap to the window, or scroll sideways.">
          <Segmented
            label="Long lines"
            value={preferences.diffOverflow}
            options={[
              ['wrap', 'Wrap'],
              ['scroll', 'Scroll'],
            ]}
            onChange={(diffOverflow) => updateAppPreferences({ diffOverflow })}
          />
        </SettingRow>
        <SettingRow label="Line numbers">
          <Toggle
            label="Show line numbers"
            checked={preferences.diffLineNumbers}
            onChange={(diffLineNumbers) => updateAppPreferences({ diffLineNumbers })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Highlighting">
        <SettingRow
          label="Changes within a line"
          description="Mark exactly what changed inside edited lines."
        >
          <Segmented
            label="Changes within a line"
            value={preferences.diffHighlight}
            options={[
              ['word', 'Words'],
              ['char', 'Characters'],
              ['none', 'Off'],
            ]}
            onChange={(diffHighlight) => updateAppPreferences({ diffHighlight })}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
