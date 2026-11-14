import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRef, useState } from 'react'
import { View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import {
  botAvatarPreviewSchema,
  botResultSchema,
  randomUUID,
  harnessAvailabilityCandidates,
  providerDisplayName,
  type BotAvatarGenerate,
  responses,
  type BotResult,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { detailDraftKey } from '../runtime/state/detail-drafts'
import { Sheet } from '../ui/layout/sheet'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { Text } from '../ui/content/text'
import { BotAvatar } from './bot-avatar'

type Draft = {
  prompt: string
  harnessId?: string
  preview?: string
  request?: BotAvatarGenerate
}
const drafts = new Map<string, Draft>()

export function BotAvatarEditor({
  task,
  onSaved,
  onClose,
}: {
  task: Task
  onSaved: (result: BotResult) => void
  onClose: () => void
}) {
  const uiText = useInterfaceText()

  const { call, connected, snapshot, profile } = useRuntime()
  const key = detailDraftKey(profile?.connection ?? null, 'bot-avatar', task.id)
  const [draft, setDraft] = useState<Draft>(
    () =>
      drafts.get(key) ?? {
        prompt: 'A friendly illustrated assistant, clean background, clear at small sizes.',
      },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const harnesses = harnessAvailabilityCandidates(
    snapshot?.workspace.agents ?? [],
    snapshot?.acpInstallations ?? [],
  ).map(({ id, agent }) => ({
    id,
    name: id.startsWith('harness:') ? providerDisplayName(agent.provider) : agent.name,
  }))
  if (draft.harnessId && !harnesses.some((choice) => choice.id === draft.harnessId))
    harnesses.push({ id: draft.harnessId, name: 'Unavailable harness' })
  const retain = (value: Draft) => {
    drafts.set(key, value)
    setDraft(value)
  }
  const disabled = busy || !connected || !snapshot?.botAvatarsSupported
  const act = async (run: () => Promise<void>) => {
    if (disabled || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await run()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const save = (avatar: string | null) =>
    act(async () => {
      const result = await call(
        '/api/bots/update',
        { id: task.id, expectedRevision: task.bot?.revision, avatar },
        botResultSchema,
      )
      onSaved(result)
      retain({ ...draft, preview: undefined, request: undefined })
    })
  return (
    <Sheet title={uiText('Avatar')} onClose={onClose}>
      <View style={{ gap: 12 }}>
        <BotAvatar name={task.title} avatar={draft.preview ?? task.bot?.avatar} size={96} />
        {!snapshot?.botAvatarsSupported && <Text>Update this runtime to set a Bot avatar.</Text>}
        <Action
          label="Choose avatar image"
          disabled={disabled}
          onPress={() =>
            void act(async () => {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
                base64: true,
              })
              if (result.canceled) return
              const data = result.assets[0]?.base64
              if (!data) throw Error('Could not read this image. Choose another image.')
              if (data.length > 7 * 1024 * 1024) throw Error('Choose an image smaller than 5 MB.')
              const preview = await call(
                '/api/bots/avatar/upload',
                { id: task.id, data },
                botAvatarPreviewSchema,
              )
              retain({ ...draft, preview: preview.avatar })
            })
          }
        />
        <Choice
          label="Avatar generation harness"
          value={draft.harnessId ?? ''}
          items={[{ id: '', name: 'Use Bot harness' }, ...harnesses]}
          disabled={disabled || !!draft.request || !snapshot?.botAvatarHarnessSelectionSupported}
          onChange={(harnessId) => retain({ ...draft, harnessId: harnessId || undefined })}
        />
        <Field
          label="Avatar description"
          value={draft.prompt}
          editable={!disabled && !draft.request}
          maxLength={2000}
          onChangeText={(prompt) => retain({ ...draft, prompt })}
        />
        <Text>
          A temporary chat uses the selected harness, this Bot’s access limits and installed image
          tools. It returns a preview without posting to the conversation. Image generation can
          incur provider charges.
        </Text>
        <Action
          label={busy ? 'Working…' : draft.request ? 'Retry generation' : 'Generate avatar'}
          disabled={disabled || !draft.prompt.trim()}
          onPress={() =>
            void act(async () => {
              const input = draft.request ?? {
                id: task.id,
                requestId: randomUUID(),
                prompt: draft.prompt.trim(),
                ...(draft.harnessId ? { harnessId: draft.harnessId } : {}),
              }
              retain({ ...draft, request: input })
              const result = await call('/api/bots/avatar/generate', input, botAvatarPreviewSchema)
              if (drafts.get(key)?.request?.requestId === input.requestId)
                retain({ ...draft, preview: result.avatar, request: undefined })
            })
          }
        />
        {draft.request && (
          <Action
            secondary
            label="Cancel generation"
            disabled={!connected}
            onPress={() => {
              if (!draft.request) return
              void call('/api/bots/avatar/cancel', draft.request, responses.ok)
                .then(() => {
                  if (drafts.get(key)?.request?.requestId === draft.request?.requestId)
                    retain({ ...drafts.get(key)!, request: undefined })
                })
                .catch((error: unknown) => setError(String(error)))
            }}
          />
        )}
        {draft.preview && (
          <>
            <Action
              label="Use avatar"
              disabled={disabled}
              onPress={() => {
                if (draft.preview) void save(draft.preview)
              }}
            />
            <Action
              secondary
              label="Discard preview"
              disabled={busy}
              onPress={() => retain({ ...draft, preview: undefined })}
            />
          </>
        )}
        {task.bot?.avatar && (
          <Action
            secondary
            label="Remove avatar"
            disabled={disabled}
            onPress={() => void save(null)}
          />
        )}
        {!!error && <Text accessibilityRole="alert">{error}</Text>}
      </View>
    </Sheet>
  )
}
