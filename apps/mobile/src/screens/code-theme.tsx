import { useState } from 'react'
import { View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import {
  addImportedCodeTheme,
  importCodeTheme,
  maxCodeThemeBytes,
  type ImportedCodeTheme,
} from '@dovo/studio-core/code-themes'
import { studioThemeIds, studioThemes } from '@dovo/studio-core/themes'
import {
  updateMobilePreferences,
  readMobilePreferences,
  useMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { SettingsAction, SettingsChoice } from './settings-controls'
import { SettingsGroup } from './settings-group'
import { Text } from '../ui/content/text'
import { CodeThemeBrowser } from './code-theme-browser'
import { useSettingsTheme } from './settings-theme'

export function CodeThemeSettings() {
  const { codeTheme, importedCodeThemes } = useMobilePreferences()
  const { styles } = useSettingsTheme()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [browse, setBrowse] = useState(false)
  const saveTheme = (theme: ImportedCodeTheme) => {
    updateMobilePreferences({
      importedCodeThemes: addImportedCodeTheme(readMobilePreferences().importedCodeThemes, theme),
      codeTheme: theme.name,
    })
    setError('')
  }
  const items = [
    { id: 'app', name: 'Follow app' },
    ...studioThemeIds.map((id) => ({ id, name: studioThemes[id].name })),
    ...importedCodeThemes.map((theme) => ({
      id: theme.name,
      name: `${theme.label} (${theme.type})`,
    })),
  ]
  const importFile = async () => {
    setError('')
    setBusy(true)
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: '*/*',
      })
      if (result.canceled) return
      const file = new File(result.assets[0].uri)
      if (file.size > maxCodeThemeBytes) throw new Error('Choose a theme file smaller than 1 MB.')
      const theme = importCodeTheme(await file.text(), result.assets[0].name)
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
      footer="Follow app uses the app palette. Browse Open VSX or import a standalone VS Code JSON/JSONC theme. Native syntax uses matching token-category colors; semantic-only rules are not used."
    >
      <SettingsChoice
        label="Code theme"
        value={items.some((item) => item.id === codeTheme) ? codeTheme : 'app'}
        items={items}
        onChange={(codeTheme) => {
          if (items.some((item) => item.id === codeTheme)) updateMobilePreferences({ codeTheme })
        }}
      />
      <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
        <SettingsAction secondary label="Browse VS Code themes" onPress={() => setBrowse(true)} />
        <SettingsAction
          secondary
          label="Import VS Code theme"
          disabled={busy}
          onPress={() => void importFile()}
        />
        {importedCodeThemes.some((theme) => theme.name === codeTheme) && (
          <SettingsAction
            secondary
            label="Remove theme"
            disabled={busy}
            onPress={() =>
              updateMobilePreferences({
                codeTheme: 'app',
                importedCodeThemes: importedCodeThemes.filter((theme) => theme.name !== codeTheme),
              })
            }
          />
        )}
      </View>
      {browse && <CodeThemeBrowser onClose={() => setBrowse(false)} onImport={saveTheme} />}
      {error && (
        <View style={{ padding: 12 }}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        </View>
      )}
    </SettingsGroup>
  )
}
