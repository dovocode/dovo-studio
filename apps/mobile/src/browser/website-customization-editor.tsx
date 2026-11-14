import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const sheet = useRef<SheetHandle>(null)
  const [draft, setDraft] = useState(website)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (remove = false) => {
    if (busy) return
    const scriptError = !remove && draft.enabled && browserWebsiteScriptError(draft.script)
    if (scriptError) {
      setError(uiText('JavaScript: {value0}', { value0: scriptError }))
      return
    }
    const result = decodeResult(browserWebsiteCustomizationSchema, draft)
    if (!result.success) {
      setError(uiText('CSS and JavaScript must each be at most 64,000 characters.'))
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
    <Sheet ref={sheet} title={uiText('Customize website')} onClose={onClose} busy={busy}>
      <Text style={styles.muted}>
        <InterfaceText values={{ value0: website.origin, value1: profileName }}>
          {'{value0} · {value1}. Saved for this profile only.'}
        </InterfaceText>
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text>
          <InterfaceText>{'Enable customization'}</InterfaceText>
        </Text>
        <Switch
          accessibilityLabel={uiText('Enable customization')}
          value={draft.enabled}
          disabled={busy}
          onValueChange={(enabled) => setDraft({ ...draft, enabled })}
        />
      </View>
      <Field
        label={uiText('Website CSS')}
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
        label={uiText('Website JavaScript')}
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
        <InterfaceText>
          {
            'Scripts run at DOM ready with this website’s permissions. Saving reloads this tab. Reload clears page changes but cannot undo changes to website data.'
          }
        </InterfaceText>
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {onAgent && (
        <Action
          label={uiText('Customize with agent…')}
          secondary
          disabled={busy}
          onPress={() => sheet.current?.dismiss(() => onAgent(draft))}
        />
      )}
      <Action
        destructive
        label={uiText('Remove')}
        secondary
        disabled={busy}
        onPress={() => void save(true)}
      />
      <Action
        label={busy ? uiText('Saving…') : uiText('Save and reload')}
        disabled={busy}
        onPress={() => void save()}
      />
    </Sheet>
  )
}
