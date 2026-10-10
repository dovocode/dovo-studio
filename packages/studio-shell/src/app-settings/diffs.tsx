import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'
import { SettingsSelect } from './settings-select'

function DiffSettingsRows() {
  const preferences = useAppPreferences()
  return (
    <>
      <SettingsGroup title="Changes in conversations">
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
          label="Open review panels automatically"
          description="Open linked pull requests, or Changes when edits reach 3 files or 50 lines."
        >
          <Toggle
            label="Open review panels automatically"
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
          label="Default diff layout"
          description="Unified shows changes inline. Split shows old and new code side by side."
        >
          <SettingsSelect
            label="Default diff layout"
            value={preferences.diffLayout}
            options={[
              ['unified', 'Unified (inline)'],
              ['split', 'Split (side by side)'],
            ]}
            onChange={(diffLayout) => updateAppPreferences({ diffLayout })}
          />
        </SettingRow>
        <SettingRow label="Long lines" description="Wrap to the window, or scroll sideways.">
          <SettingsSelect
            label="Long lines"
            value={preferences.diffOverflow}
            options={[
              ['wrap', 'Wrap'],
              ['scroll', 'Scroll'],
            ]}
            onChange={(diffOverflow) => updateAppPreferences({ diffOverflow })}
          />
        </SettingRow>
        <SettingRow label="Show line numbers">
          <Toggle
            label="Show line numbers"
            checked={preferences.diffLineNumbers}
            onChange={(diffLineNumbers) => updateAppPreferences({ diffLineNumbers })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Change highlighting">
        <SettingRow
          label="Changes within a line"
          description="Mark exactly what changed inside edited lines."
        >
          <SettingsSelect
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
