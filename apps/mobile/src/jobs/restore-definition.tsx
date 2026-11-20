import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  createDetailDrafts,
  useDetailDraft,
  computerDraftKey,
} from '../runtime/state/detail-drafts'
import { detailDraftStorage } from '../runtime/state/detail-draft-storage'
import { DraftStorageNotice } from '../ui/content/draft-storage-notice'
import { Schema } from 'effect'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import {
  automationSchema,
  automationRestoreDraftSchema,
  decode,
  mutableStruct,
  routineChangeSummary,
  restorableAutomation,
  type Automation,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Sheet } from '../ui/layout/sheet'
import { Field } from '../ui/controls/field'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

// An edited definition stays on the device after the app restarts. It holds no credentials.
const drafts = createDetailDrafts<{ text: string; expected?: Automation }>({
  isClean: (value) => !value.text,
  persist: {
    name: 'automation-restore',
    schema: mutableStruct({ text: Schema.String, expected: Schema.optional(automationSchema) }),
    storage: detailDraftStorage,
  },
})

export function RestoreDefinition({
  runId,
  automationId,
}: {
  runId: string
  automationId: string
}) {
  const uiText = useInterfaceText()
  const { call, connected, snapshot, profile } = useRuntime()
  const { styles } = useTheme()
  const retained = useDetailDraft(
    drafts,
    computerDraftKey(profile, 'automation-restore', runId),
    () => ({ text: '' }),
  )
  const draft = retained.draft.text,
    expected = retained.draft.expected
  const setDraft = (text: string) => retained.setField('text', text)
  const setExpected = (value: Automation | undefined) => retained.setField('expected', value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const lock = useRef(false)
  useEffect(
    () => () => {
      generation.current++
    },
    [profile?.id, profile?.connection, runId],
  )
  const act = async (operation: (version: number) => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    const version = generation.current
    try {
      await operation(version)
    } catch (cause) {
      if (version === generation.current) setError(String(cause))
    } finally {
      lock.current = false
      if (version === generation.current) setBusy(false)
    }
  }
  let changes: ReturnType<typeof routineChangeSummary> = []
  let valid = false
  try {
    const parsed = decode(automationSchema, JSON.parse(draft))
    valid = true
    changes = routineChangeSummary(
      expected,
      expected ? restorableAutomation(parsed, expected) : parsed,
    )
  } catch {
    /* Keep the draft editable. */
  }
  return (
    <View style={{ gap: 8 }}>
      <Action
        label={uiText('Restore definition from this run')}
        secondary
        disabled={!connected || busy || !snapshot?.automationRestoreSupported}
        onPress={() =>
          void act(async (version) => {
            if (version !== generation.current) return
            const current = snapshot?.workspace.automations.find((flow) => flow.id === automationId)
            if (!current) throw new Error(uiText('Automation no longer exists'))
            const result = await call(
              '/api/jobs/definition',
              { id: runId },
              automationRestoreDraftSchema,
            )
            if (version !== generation.current) return
            setDraft(JSON.stringify(result.definition, null, 2))
            setExpected(result.expected)
            setNotice('')
          })
        }
      />
      {!snapshot?.automationRestoreSupported && (
        <Text style={styles.muted}>
          {uiText('Update this computer to restore a run definition.')}
        </Text>
      )}
      {!!notice && <Text>{notice}</Text>}
      {!!error && !draft && <Text accessibilityRole="alert">{error}</Text>}
      {!!draft && (
        <Sheet
          title={uiText('Restore automation definition')}
          busy={busy}
          onClose={() => {
            if (!busy) {
              setDraft('')
              setExpected(undefined)
            }
          }}
        >
          <View style={{ gap: 12 }}>
            <Text style={styles.muted}>
              {uiText(
                'Edit and compare before saving. Current credentials stay in place. Automatic triggers will be paused. Running jobs keep their definitions.',
              )}
            </Text>
            <Field
              label={uiText('Restored automation definition')}
              multiline
              value={draft}
              onChangeText={setDraft}
              editable={!busy}
            />
            {changes.map((change) => (
              <Text key={change.label}>
                {change.label}: {change.before ?? uiText('None')} → {change.after ?? uiText('None')}
              </Text>
            ))}
            {!valid && (
              <Text accessibilityRole="alert">
                {uiText('Enter a valid automation definition.')}
              </Text>
            )}
            <DraftStorageNotice persistence={retained.persistence} />
            {!!error && <Text accessibilityRole="alert">{error}</Text>}
            <Action
              label={uiText('Compare with current definition')}
              secondary
              disabled={busy || !connected}
              onPress={() =>
                void act(async (version) => {
                  const latest = await call(
                    '/api/jobs/definition',
                    { id: runId },
                    automationRestoreDraftSchema,
                  )
                  if (version === generation.current) setExpected(latest.expected)
                })
              }
            />
            <Action
              label={uiText('Save restored definition')}
              disabled={!valid || !expected || busy || !connected}
              onPress={() =>
                void act(async (version) => {
                  const definition = decode(automationSchema, JSON.parse(draft))
                  if (version !== generation.current) return
                  await call(
                    '/api/jobs/restore',
                    { id: runId, expected, definition },
                    automationSchema,
                  )
                  if (version !== generation.current) return
                  setDraft('')
                  setExpected(undefined)
                  setNotice(uiText('Definition restored. Automatic triggers are paused.'))
                })
              }
            />
          </View>
        </Sheet>
      )}
    </View>
  )
}
