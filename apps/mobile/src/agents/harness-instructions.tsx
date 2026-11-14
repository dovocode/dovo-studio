import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { Alert, View } from 'react-native'
import { useHarnessInstructions } from '@dovo/studio-core/harness-instructions'
import { providerDisplayName } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { useSettingsDraft } from '../runtime/preferences/settings-target'
import {
  SettingsAction as Action,
  SettingsChoice as Choice,
  SettingsField as Field,
} from '../screens/settings-controls'
import { useSettingsTheme } from '../screens/settings-theme'
import { Text } from '../ui/content/text'
import { useState } from 'react'

export function HarnessInstructions() {
  const uiText = useInterfaceText()

  const { call, connected, snapshot, profile } = useRuntime()
  const { styles } = useSettingsTheme()
  const [opened, setOpened] = useState(false)
  const editor = useHarnessInstructions({
    scope: JSON.stringify([profile?.id, profile?.connection.address, profile?.connection.token]),
    request: call,
    connected,
    supported: snapshot?.harnessInstructionsSupported === true && opened,
  })
  useSettingsDraft(editor.dirty, editor.busy)
  const file = editor.selected
  const draft = editor.draft
  return (
    <View style={[styles.card, { gap: 12 }]}>
      <Text style={styles.text}>
        <InterfaceText>{'Harness instruction files'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Edit native harness files on this computer. Files can be shared by several profiles. Review the diff before saving.'
          }
        </InterfaceText>
      </Text>
      {snapshot?.harnessInstructionsSupported !== true ? (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Update Dovo on this computer to edit harness instruction files.'}
          </InterfaceText>
        </Text>
      ) : !opened ? (
        <Action
          secondary
          label={uiText('Edit harness instruction files')}
          disabled={!connected}
          onPress={() => setOpened(true)}
        />
      ) : (
        <>
          <Choice
            label={uiText('Harness instruction file')}
            value={file?.id ?? ''}
            disabled={editor.disabled || !editor.files.length}
            items={editor.files.map((item) => ({
              id: item.id,
              name: `${providerDisplayName(item.provider)} · ${item.name} · ${item.profiles.join(', ')}`,
            }))}
            onChange={editor.select}
          />
          {file && (
            <>
              <Text selectable style={styles.muted}>
                {file.path}
              </Text>
              {draft && draft.resolvedPath !== file.path && (
                <Text selectable style={styles.muted}>
                  <InterfaceText values={{ value0: draft.resolvedPath }}>
                    {'Linked file: {value0}'}
                  </InterfaceText>
                </Text>
              )}
              <Text style={styles.muted}>{file.description}</Text>
              {draft && !draft.exists && (
                <Text style={styles.muted}>
                  <InterfaceText>
                    {'This file does not exist yet. Saving creates it.'}
                  </InterfaceText>
                </Text>
              )}
            </>
          )}
          <Field
            label={uiText('Harness instructions')}
            value={draft?.text ?? ''}
            editable={!editor.disabled && !!draft}
            multiline
            style={{ minHeight: 260, textAlignVertical: 'top' }}
            onChangeText={editor.text}
          />
          {!!draft?.diff && (
            <Text selectable style={styles.muted}>
              {draft.diff}
            </Text>
          )}
          <Action
            secondary
            label={uiText('Review diff')}
            disabled={editor.disabled || !draft}
            onPress={() => void editor.review()}
          />
          <Action
            label={uiText('Save instruction file')}
            disabled={editor.disabled || !draft?.reviewed}
            onPress={() => void editor.save()}
          />
          <Action
            secondary
            label={uiText('Reload disk version')}
            disabled={editor.disabled || !file}
            onPress={() => void editor.reload()}
          />
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Reload keeps your draft for a new diff review. Start a new harness session to use saved changes.'
              }
            </InterfaceText>
          </Text>
          <Action
            destructive
            secondary
            label={uiText('Discard draft')}
            disabled={editor.disabled || !draft || draft.text === draft.original}
            onPress={() =>
              Alert.alert(
                uiText('Discard instruction draft?'),
                uiText(
                  'Your edits to this file will be removed. The file on disk stays unchanged.',
                ),
                [
                  { text: uiText('Keep editing'), style: 'cancel' },
                  { text: uiText('Discard draft'), style: 'destructive', onPress: editor.reset },
                ],
              )
            }
          />
          <Action
            secondary
            label={uiText('Reload file list')}
            disabled={editor.disabled}
            onPress={editor.retry}
          />
        </>
      )}
      {!!editor.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {editor.error}
        </Text>
      )}
      {!!editor.notice && (
        <Text accessibilityRole="status" style={styles.muted}>
          {editor.notice}
        </Text>
      )}
      {!connected && (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Reconnect this computer to read or save files. Your drafts are kept.'}
          </InterfaceText>
        </Text>
      )}
      {editor.notices.map((notice) => (
        <Text key={notice} style={styles.muted}>
          {notice}
        </Text>
      ))}
    </View>
  )
}
