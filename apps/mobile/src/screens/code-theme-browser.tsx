import { useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { nativeCodeColors, type ImportedCodeTheme } from '@dovo/studio-core/code-themes'
import { themeCatalogUrl, useCodeThemeCatalog } from '@dovo/studio-core/theme-catalog'
import { Sheet } from '../ui/layout/sheet'
import { Text } from '../ui/content/text'
import { SearchField } from '../ui/controls/field'
import { Action } from '../ui/controls/action'
import { useTheme } from '../ui/theme'

export function CodeThemeBrowser({
  onClose,
  onImport,
}: {
  onClose: () => void
  onImport: (theme: ImportedCodeTheme) => void
}) {
  const catalog = useCodeThemeCatalog()
  const selected = catalog.selected
  const { colors, styles } = useTheme()
  const [error, setError] = useState('')
  const openSource = (url: string) => {
    void Linking.openURL(url).catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    )
  }
  const importTheme = (theme: ImportedCodeTheme) => {
    try {
      onImport(theme)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Sheet title="Browse VS Code themes" onClose={onClose}>
      <Text style={styles.muted}>
        From Open VSX, the public registry for VS Code-compatible extensions. Import colors only;
        extension code is never installed.
      </Text>
      {selected ? (
        <>
          <Action
            label="Back to themes"
            secondary
            onPress={() => {
              catalog.select()
              setError('')
            }}
          />
          <Text style={styles.title}>{selected.displayName ?? selected.name}</Text>
          <Text style={styles.muted}>
            {selected.namespace}.{selected.name} · {selected.version}
          </Text>
          <Text style={styles.muted}>{selected.description}</Text>
          <Action
            label="View on Open VSX"
            secondary
            onPress={() => openSource(themeCatalogUrl(selected))}
          />
          {!catalog.bundle && !catalog.bundleError && (
            <Text style={styles.muted}>Downloading theme previews…</Text>
          )}
          {catalog.bundleError && (
            <>
              <Text accessibilityRole="alert" style={styles.error}>
                {catalog.bundleError}
              </Text>
              <Action label="Retry download" secondary onPress={catalog.retryBundle} />
            </>
          )}
          {catalog.bundle?.themes.map((theme) => {
            const preview = nativeCodeColors(theme)
            return (
              <View key={theme.name} style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
                <View style={{ padding: 12, gap: 4 }}>
                  <Text style={styles.title}>{theme.label}</Text>
                  <Text style={styles.muted}>
                    {theme.type === 'dark' ? 'Dark' : 'Light'}
                    {theme.source?.license ? ` · ${theme.source.license}` : ''}
                  </Text>
                </View>
                <View style={{ padding: 14, backgroundColor: preview.background }}>
                  <Text
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      lineHeight: 22,
                      color: preview.text,
                    }}
                  >
                    <Text style={{ color: preview.comment }}>// Editor & diff preview</Text>
                    {'\n'}
                    <Text style={{ color: preview.keyword }}>const</Text>{' '}
                    <Text style={{ color: preview.function }}>greet</Text>
                    {' = (name) =>\n  '}
                    <Text style={{ color: preview.string }}>"Hello "</Text>
                    {' + name;\n'}
                    <Text style={{ color: preview.function }}>greet</Text>
                    {'('}
                    <Text style={{ color: preview.string }}>"Dovo"</Text>
                    {');'}
                  </Text>
                </View>
                <View style={{ padding: 12 }}>
                  <Action label={`Import ${theme.label}`} wide onPress={() => importTheme(theme)} />
                </View>
              </View>
            )
          })}
          {catalog.bundle?.warnings.map((warning, index) => (
            <Text key={index} style={styles.muted}>
              {warning}
            </Text>
          ))}
        </>
      ) : (
        <>
          <SearchField
            label="Search VS Code themes"
            placeholder="Search themes or publishers…"
            value={catalog.query}
            onChangeText={catalog.setQuery}
          />
          {catalog.page?.extensions.map((extension) => (
            <Pressable
              key={`${extension.namespace}.${extension.name}`}
              accessibilityRole="button"
              accessibilityLabel={`${extension.displayName ?? extension.name}, ${extension.namespace}`}
              onPress={() => catalog.select(extension)}
              style={({ pressed }) => [styles.card, { opacity: pressed ? 0.65 : 1 }]}
            >
              <Text style={styles.title}>{extension.displayName ?? extension.name}</Text>
              <Text style={styles.muted}>
                {extension.namespace}.{extension.name}
              </Text>
              <Text style={styles.text} numberOfLines={2}>
                {extension.description}
              </Text>
              {extension.downloadCount !== undefined && (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {extension.downloadCount.toLocaleString()} downloads
                </Text>
              )}
            </Pressable>
          ))}
          {catalog.loading && <Text style={styles.muted}>Loading themes…</Text>}
          {catalog.error && (
            <>
              <Text accessibilityRole="alert" style={styles.error}>
                {catalog.error}
              </Text>
              <Action label="Retry search" secondary onPress={catalog.retry} />
            </>
          )}
          {!catalog.loading && !catalog.error && catalog.page?.extensions.length === 0 && (
            <Text style={styles.muted}>No code themes found. Try another name.</Text>
          )}
          {!catalog.loading &&
            !catalog.error &&
            catalog.page &&
            catalog.page.offset + 20 < catalog.page.totalSize && (
              <Action label="Load more themes" secondary onPress={catalog.more} />
            )}
          <Action
            label="About Open VSX"
            secondary
            onPress={() => openSource('https://open-vsx.org')}
          />
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Sheet>
  )
}
