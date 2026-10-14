import { useRef, useState } from 'react'
import {
  importCodeTheme,
  readAppPreferences,
  maxCodeThemeBytes,
  studioThemeIds,
  studioThemes,
  updateAppPreferences,
  useAppPreferences,
} from '@dovo/studio-core'
import { addImportedCodeTheme, type ImportedCodeTheme } from '@dovo/studio-core/code-themes'
import { CodeThemeBrowser } from './code-theme-browser'
import { Button } from '@dovo/studio-ui'
import { SettingRow, SettingsGroup } from './layout'
import { SettingsSelect } from './settings-select'

export function CodeThemeSettings() {
  const { codeTheme, importedCodeThemes } = useAppPreferences()
  const picker = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [browse, setBrowse] = useState(false)
  const saveTheme = (theme: ImportedCodeTheme) => {
    updateAppPreferences({
      importedCodeThemes: addImportedCodeTheme(readAppPreferences().importedCodeThemes, theme),
      codeTheme: theme.name,
    })
    setError('')
  }
  const options: [string, string][] = [
    ['app', 'Follow app'],
    ...studioThemeIds.map((id): [string, string] => [id, studioThemes[id].name]),
    ...importedCodeThemes.map((theme): [string, string] => [
      theme.name,
      `${theme.label} (${theme.type})`,
    ]),
  ]
  const importFile = async (file: File) => {
    setError('')
    setBusy(true)
    try {
      if (file.size > maxCodeThemeBytes) throw new Error('Choose a theme file smaller than 1 MB.')
      const theme = importCodeTheme(await file.text(), file.name)
      saveTheme(theme)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsGroup
      title="Editors & diffs"
      description="Code colors are independent of the app palette. Palette choices follow the app’s light or dark mode; imported themes use their own mode."
    >
      <SettingRow label="Code theme">
        <SettingsSelect
          label="Code theme"
          value={options.some(([id]) => id === codeTheme) ? codeTheme : 'app'}
          options={options}
          onChange={(codeTheme) => updateAppPreferences({ codeTheme })}
        />
      </SettingRow>
      <SettingRow
        label="VS Code themes"
        description="Browse Open VSX or import a standalone JSON/JSONC file. TextMate token colors are supported; semantic-only rules are not used."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setBrowse(true)}>
            Browse VS Code themes
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            Import VS Code theme
          </Button>
          {importedCodeThemes.some((theme) => theme.name === codeTheme) && (
            <Button
              variant="ghost"
              disabled={busy}
              size="sm"
              onClick={() =>
                updateAppPreferences({
                  codeTheme: 'app',
                  importedCodeThemes: importedCodeThemes.filter(
                    (theme) => theme.name !== codeTheme,
                  ),
                })
              }
            >
              Remove theme
            </Button>
          )}
        </div>
        <input
          ref={picker}
          type="file"
          accept=".json,.jsonc,application/json"
          aria-label="VS Code theme file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void importFile(file)
          }}
        />
      </SettingRow>
      {browse && <CodeThemeBrowser onClose={() => setBrowse(false)} onImport={saveTheme} />}
      {importedCodeThemes.find((theme) => theme.name === codeTheme)?.source && (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          Imported from Open VSX. Theme colors apply to this device.
        </p>
      )}
      {error && (
        <p role="alert" className="px-4 pb-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </SettingsGroup>
  )
}
