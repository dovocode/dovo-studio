import { useState } from 'react'
import { View } from 'react-native'
import {
  browserSearchProviders,
  browserSearchEngineSchema,
  decodeResult,
  type BrowserSearchEngine,
} from '@dovo/protocol'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

export function BrowserSearchSettings({
  value,
  disabled,
  onSave,
}: {
  value?: BrowserSearchEngine
  disabled: boolean
  onSave: (search: BrowserSearchEngine) => Promise<void>
}) {
  const { styles } = useTheme()
  const [engine, setEngine] = useState<BrowserSearchEngine['engine']>(value?.engine ?? 'google')
  const [url, setUrl] = useState(value?.engine === 'custom' ? value.url : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const search: BrowserSearchEngine = engine === 'custom' ? { engine, url: url.trim() } : { engine }
  const valid = decodeResult(browserSearchEngineSchema, search).success
  const changed = JSON.stringify(search) !== JSON.stringify(value ?? { engine: 'google' })
  return (
    <View style={{ gap: 8 }}>
      <Choice
        label="Default search engine"
        value={engine}
        disabled={disabled || busy}
        items={[...browserSearchProviders, { id: 'custom', name: 'Custom URL' }]}
        onChange={(id) => {
          if (id === 'custom') setEngine(id)
          else {
            const provider = browserSearchProviders.find((provider) => provider.id === id)
            if (provider) setEngine(provider.id)
          }
          setError('')
        }}
      />
      {engine === 'custom' && (
        <>
          <Field
            label="Search URL"
            value={url}
            onChangeText={setUrl}
            placeholder="https://example.com/search?q=%s"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled && !busy}
          />
          <Text style={valid ? styles.muted : styles.error}>
            Use an HTTP or HTTPS URL containing %s for the search term, without credentials.
          </Text>
        </>
      )}
      {changed && (
        <Action
          label={busy ? 'Saving search engine…' : 'Save search engine'}
          disabled={disabled || busy || !valid}
          onPress={() => {
            setBusy(true)
            setError('')
            void onSave(search)
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setBusy(false))
          }}
        />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
