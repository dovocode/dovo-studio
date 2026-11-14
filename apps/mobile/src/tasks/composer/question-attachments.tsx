import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { Attachment } from '@dovo/protocol'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useRuntime } from '../../runtime/connection/provider'
import { useAttachmentPicker } from './attachment-picker'

export function QuestionAttachments({
  taskId,
  questionId,
  files,
  count,
  disabled,
  onAdd,
  onRemove,
  onBusy,
}: {
  taskId: string
  questionId: string
  files: Attachment[]
  count: number
  disabled: boolean
  onAdd: (file: Attachment) => boolean
  onRemove: (id: string) => void
  onBusy: (busy: boolean) => void
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const { profile, discardAttachment } = useRuntime()
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')
  const attachments = useAttachmentPicker(taskId, undefined, {
    key: questionId,
    files,
    count,
    uploaded: onAdd,
  })
  useEffect(() => {
    onBusy(attachments.busy || removing)
    return () => onBusy(false)
  }, [attachments.busy, removing])
  return (
    <View style={{ gap: 6 }}>
      {files.map((file) => (
        <View key={file.id} style={[styles.row, { gap: 8 }]}>
          <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
            {file.name}
          </Text>
          <Action
            destructive
            secondary
            label={uiText('Remove {value0}', { value0: file.name })}
            disabled={disabled}
            onPress={() => {
              if (!profile || removing) return
              setRemoving(true)
              setRemoveError('')
              void discardAttachment(profile, file.id)
                .then(
                  () => onRemove(file.id),
                  (error: unknown) => setRemoveError(String(error)),
                )
                .finally(() => setRemoving(false))
            }}
          />
        </View>
      ))}
      <View style={[styles.row, { gap: 8 }]}>
        <Action
          secondary
          label={attachments.busy ? uiText('Attaching…') : uiText('Attach files to answer')}
          disabled={disabled || count >= 5}
          onPress={attachments.pick}
        />
        <Action
          secondary
          label={uiText('Paste image')}
          disabled={disabled || count >= 5}
          onPress={attachments.pasteImage}
        />
      </View>
      {!!removeError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {removeError}
        </Text>
      )}
      {!!attachments.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {attachments.error}
        </Text>
      )}
      {attachments.editor}
    </View>
  )
}
