import { useRef, useState } from 'react'
import { Switch, View } from 'react-native'
import {
  browserWebsiteCustomizationSchema,
  browserWebsiteScriptError,
  decodeResult,
  type BrowserWebsiteCustomization,
} from '@dovo/protocol'
import { Sheet, type SheetHandle } from '../ui/layout/sheet'
import { Field } from '../ui/controls/field'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

export function WebsiteCustomizationEditor({
  website,
  profileName,
  onClose,
  onSave,
  onAgent,
}: {
  website: BrowserWebsiteCustomization
  profileName: string
  onClose: () => void
  onSave: (website: BrowserWebsiteCustomization | null) => Promise<void>
  onAgent?: (website: BrowserWebsiteCustomization) => void
}) {
  const { styles } = useTheme()
  const sheet = useRef<SheetHandle>(null)
  const [draft, setDraft] = useState(website)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (remove = false) => {
    if (busy) return
    const scriptError = !remove && draft.enabled && browserWebsiteScriptError(draft.script)
    if (scriptError) {
      setError(`JavaScript: ${scriptError}`)
      return
    }
    const result = decodeResult(browserWebsiteCustomizationSchema, draft)
    if (!result.success) {
      setError('CSS and JavaScript must each be at most 64,000 characters.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave(remove ? null : result.data)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet ref={sheet} title="Customize website" onClose={onClose} busy={busy}>
      <Text style={styles.muted}>
        {website.origin} · {profileName}. Saved for this profile only.
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text>Enable customization</Text>
        <Switch
          accessibilityLabel="Enable customization"
          value={draft.enabled}
          disabled={busy}
          onValueChange={(enabled) => setDraft({ ...draft, enabled })}
        />
      </View>
      <Field
        label="Website CSS"
        multiline
        style={{ minHeight: 150, textAlignVertical: 'top', fontFamily: 'monospace' }}
        autoCapitalize="none"
        autoCorrect={false}
        value={draft.css}
        maxLength={64000}
        editable={!busy}
        onChangeText={(css) => setDraft({ ...draft, css })}
      />
      <Field
        label="Website JavaScript"
        multiline
        style={{ minHeight: 120, textAlignVertical: 'top', fontFamily: 'monospace' }}
        autoCapitalize="none"
        autoCorrect={false}
        value={draft.script}
        maxLength={64000}
        editable={!busy}
        onChangeText={(script) => setDraft({ ...draft, script })}
      />
      <Text style={styles.muted}>
        Scripts run at DOM ready with this website’s permissions. Saving reloads this tab. Reload
        clears page changes but cannot undo changes to website data.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {onAgent && (
        <Action
          label="Customize with agent…"
          secondary
          disabled={busy}
          onPress={() => sheet.current?.dismiss(() => onAgent(draft))}
        />
      )}
      <Action label="Remove" secondary disabled={busy} onPress={() => void save(true)} />
      <Action
        label={busy ? 'Saving…' : 'Save and reload'}
        disabled={busy}
        onPress={() => void save()}
      />
    </Sheet>
  )
}
