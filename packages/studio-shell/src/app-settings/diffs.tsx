import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Segmented, Toggle } from './layout'

export function DiffSettingsRows() {
  const preferences = useAppPreferences()
  return (
    <>
      <SettingsGroup title="Conversation">
        <SettingRow
          label="Hide whitespace changes"
          description="Hide files whose only changes are whitespace."
        >
          <Toggle
            label="Hide whitespace changes"
            checked={preferences.hideWhitespaceChanges}
            onChange={(hideWhitespaceChanges) => updateAppPreferences({ hideWhitespaceChanges })}
          />
        </SettingRow>
        <SettingRow
          label="Proactive panels"
          description="Open linked pull requests first, otherwise open Changes for edits to at least 3 files or 50 lines."
        >
          <Toggle
            label="Proactive panels"
            checked={preferences.proactivePanels}
            onChange={(proactivePanels) => updateAppPreferences({ proactivePanels })}
          />
        </SettingRow>
        <SettingRow
          label="Collapse changed files by default"
          description="Keep turn checkpoints compact. Each card can still be expanded."
        >
          <Toggle
            label="Collapse changed files by default"
            checked={preferences.collapseChangedFiles}
            onChange={(collapseChangedFiles) => updateAppPreferences({ collapseChangedFiles })}
          />
        </SettingRow>
      </SettingsGroup>
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
    </>
  )
}

export default function DiffSettings() {
  return (
    <SettingsPage
      local
      title="Review & diffs"
      description="How you review code changes on this device."
    >
      <DiffSettingsRows />
    </SettingsPage>
  )
}
