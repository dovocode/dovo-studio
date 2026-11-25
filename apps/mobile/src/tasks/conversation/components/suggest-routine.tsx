import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { clientScopeKey } from '@dovo/client-runtime'
import {
  randomUUID,
  routineSuggestionFields,
  routineSuggestionNextRun,
  routineSuggestionResultSchema,
  routineSuggestionWords,
  type ChatMessage,
  type RoutineSuggestionFields,
} from '@dovo/protocol'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useRuntime } from '../../../runtime/connection/provider'
import { automationHref } from '../../../shell/source-route'
import { Text } from '../../../ui/content/text'
import { Action } from '../../../ui/controls/action'
import { Field } from '../../../ui/controls/field'
import { useAction } from '../../../ui/controls/use-action'
import { Sheet } from '../../../ui/layout/sheet'
import { useTheme } from '../../../ui/theme'

export function SuggestRoutine({ taskId, message }: { taskId: string; message: ChatMessage }) {
  const uiText = useInterfaceText()
  const { colors, styles } = useTheme()
  const { call, connected, profile, snapshot } = useRuntime()
  const [draft, setDraft] = useState<RoutineSuggestionFields>()
  const { act, busy, error } = useAction()
  const id = useRef<string | undefined>(undefined)
  const scope = JSON.stringify([
    clientScopeKey(profile?.connection),
    profile?.id,
    taskId,
    message.id,
  ])
  const active = useRef('')
  useEffect(() => {
    active.current = scope
    id.current = undefined
    setDraft(undefined)
    return () => {
      active.current = ''
    }
  }, [scope])
  const bot = snapshot?.workspace.tasks.find((task) => task.id === taskId)?.bot
  const words = routineSuggestionWords(message)
  if (!words || !bot || !profile || !snapshot?.routineSuggestionsSupported) return null
  const enabled = bot.state !== 'paused'
  const next = draft && routineSuggestionNextRun(draft)
  const edit = (key: keyof RoutineSuggestionFields) => (value: string) =>
    setDraft((current) => current && { ...current, [key]: value })
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={!enabled}
        onPress={() => {
          id.current = undefined
          setDraft(
            routineSuggestionFields(
              words,
              Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            ),
          )
        }}
        style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
      >
        <Text style={{ color: colors.muted }}>{uiText('Suggest a routine')}</Text>
      </Pressable>
      {draft && (
        <Sheet title={uiText('Suggest a routine')} busy={busy} onClose={() => setDraft(undefined)}>
          <View style={{ gap: 12 }}>
            <Text style={styles.muted}>{uiText('Saving keeps the triggers paused.')}</Text>
            <Field
              label={uiText('Name')}
              maxLength={200}
              value={draft.name}
              onChangeText={edit('name')}
              editable={!busy}
            />
            <Field
              label={uiText('Instructions')}
              maxLength={16000}
              value={draft.objective}
              onChangeText={edit('objective')}
              editable={!busy}
              multiline
            />
            <Field
              label={uiText('Schedule (cron)')}
              maxLength={160}
              placeholder="0 9 * * 5"
              value={draft.schedule}
              onChangeText={edit('schedule')}
              editable={!busy}
            />
            <Field
              label={uiText('Time zone')}
              maxLength={100}
              autoCapitalize="none"
              value={draft.timezone}
              onChangeText={edit('timezone')}
              editable={!busy}
            />
            <Text style={styles.muted}>
              {next
                ? `${uiText('Next scheduled time')} · ${next.toLocaleString(undefined, { timeZone: draft.timezone.trim(), timeZoneName: 'short' })}`
                : uiText('Enter a schedule and time zone.')}
            </Text>
            {!connected && (
              <Text style={styles.muted}>{uiText('Reconnect to save this routine.')}</Text>
            )}
            {error && <Text accessibilityRole="alert">{error}</Text>}
            <Action
              label={uiText('Save paused routine')}
              disabled={
                busy ||
                !connected ||
                !enabled ||
                !draft.name.trim() ||
                !draft.objective.trim() ||
                !next
              }
              onPress={() =>
                act(async () => {
                  const result = await call(
                    '/api/jobs/from-message',
                    {
                      id: (id.current ??= randomUUID()),
                      taskId,
                      messageId: message.id,
                      draft,
                    },
                    routineSuggestionResultSchema,
                  )
                  if (active.current !== scope) return
                  setDraft(undefined)
                  router.push(automationHref(profile.id, result.id))
                })
              }
            />
          </View>
        </Sheet>
      )}
    </>
  )
}
