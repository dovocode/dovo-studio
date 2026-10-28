import { useLayoutEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import {
  conversationPageSchema,
  createRuntimeClient,
  threadContextSnapshot,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { SafeModal } from '../../ui/layout/safe-modal'
import { Text } from '../../ui/content/text'
import { Icon } from '../../ui/controls/icon'
import { useTheme } from '../../ui/theme'
import { blockAccessibleNotificationInputs } from '../../notifications/visibility'
import type { AttachmentAsset } from './attachment-picker'

export function ThreadContextPicker({
  taskId,
  disabled,
  attachmentBusy = false,
  upload,
  open: controlledOpen,
  onOpenChange,
}: {
  taskId: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled: boolean
  attachmentBusy?: boolean
  upload: (assets: AttachmentAsset[], signal: AbortSignal) => Promise<void>
}) {
  const { snapshot, profile, activeId, connected } = useRuntime()
  const { colors } = useTheme()
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  useLayoutEffect(() => {
    if (open) return blockAccessibleNotificationInputs()
  }, [open])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useLayoutEffect(() => {
    if (open) setError('')
  }, [open])
  const operation = useRef<AbortController | null>(null)
  useLayoutEffect(
    () => () => {
      operation.current?.abort()
    },
    [activeId, profile?.connection, taskId, disabled],
  )
  const close = () => {
    operation.current?.abort()
    setOpen(false)
  }
  const attach = async (source: Task) => {
    if (!profile || !connected || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError('')
    let file: File | undefined
    try {
      const client = createRuntimeClient(profile.connection)
      const transcript = await threadContextSnapshot(
        source,
        (before, signal) =>
          client.request('/api/tasks/history', { id: source.id, before }, conversationPageSchema, {
            method: 'POST',
            signal,
          }),
        controller.signal,
      )
      if (controller.signal.aborted) return
      file = new File(Paths.cache, `thread-context-${randomUUID()}.md`)
      await file.write(transcript.text)
      if (controller.signal.aborted) return
      await upload(
        [{ uri: file.uri, name: transcript.name, mimeType: 'text/markdown' }],
        controller.signal,
      )
      if (!controller.signal.aborted) setOpen(false)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (file?.exists) file.delete()
      if (operation.current === controller) {
        operation.current = null
        setBusy(false)
      }
    }
  }
  return (
    <>
      {controlledOpen === undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach thread context"
          disabled={disabled || attachmentBusy || !connected}
          onPress={() => setOpen(true)}
          style={{
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled || attachmentBusy || !connected ? 0.5 : 1,
          }}
        >
          <Icon name="newChat" size={20} color={colors.muted} />
        </Pressable>
      )}
      <SafeModal visible={open} animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, padding: 16, gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20 }}>
            Attach thread context
          </Text>
          <Text style={{ color: colors.muted }}>
            Attach a snapshot from this computer, up to 5 MB. Review it before sending; existing
            attachments are listed by name only.
          </Text>
          <TextInput
            accessibilityLabel="Search threads"
            value={query}
            onChangeText={setQuery}
            placeholder="Search threads"
            placeholderTextColor={colors.muted}
            style={{
              color: colors.text,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
            }}
          />
          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {error}
            </Text>
          ) : null}
          <ScrollView>
            {(snapshot?.workspace.tasks ?? [])
              .filter(
                (task) =>
                  task.id !== taskId &&
                  !task.example &&
                  task.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((task) => (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  disabled={busy || disabled || attachmentBusy || !connected}
                  onPress={() => void attach(task)}
                  style={{ paddingVertical: 14 }}
                >
                  <Text style={{ color: colors.text }}>{task.title || 'Untitled thread'}</Text>
                </Pressable>
              ))}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={close} style={{ padding: 12 }}>
            <Text style={{ color: colors.accent }}>Cancel</Text>
          </Pressable>
        </View>
      </SafeModal>
    </>
  )
}
