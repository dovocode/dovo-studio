import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, ScrollView, TextInput, View } from 'react-native'
import { runClientEffect } from '@dovo/client-runtime'
import { attachmentReadSchema, attachmentOcrResultSchema, type Attachment } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useTheme } from '../../../ui/theme'
import { Text } from '../../../ui/content/text'
import { Action } from '../../../ui/controls/action'
import { IconButton } from '../../../ui/controls/icon-button'
import { SafeModal } from '../../../ui/layout/safe-modal'
import { useInterfaceText } from '@dovo/studio-core/interface-language'

export function ImageOcr({
  taskId,
  file,
  disabled,
  attachText,
}: {
  taskId: string
  file: Attachment
  disabled?: boolean
  attachText?: (text: string, name: string) => Promise<void>
}) {
  const { callEffect, connected, profile } = useRuntime()
  const { styles, colors } = useTheme()
  const uiText = useInterfaceText()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  const generation = useRef(0)
  const lock = useRef(false)
  useEffect(() => {
    setOpen(false)
    setText(null)
    setImage('')
    setError('')
    return () => {
      generation.current++
    }
  }, [taskId, file.id, profile?.id, profile?.connection.address, profile?.connection.token])
  const extract = async () => {
    setOpen(true)
    if (lock.current || text !== null) return
    lock.current = true
    setBusy(true)
    setError('')
    const current = generation.current
    try {
      const source = await runClientEffect(
        callEffect('/api/attachments/read', { taskId, id: file.id }, attachmentReadSchema),
      )
      if (current !== generation.current) return
      setImage(`data:${source.attachment.mime};base64,${source.data}`)
      const result = await runClientEffect(
        callEffect('/api/attachments/ocr', { taskId, id: file.id }, attachmentOcrResultSchema),
      )
      if (current === generation.current) setText(result.text)
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <IconButton
        icon="scanText"
        label={uiText('Extract text from {value0}', { value0: file.name })}
        disabled={!connected || disabled}
        onPress={() => void extract()}
      />
      <SafeModal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.screen}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 16 }}
          >
            <Text style={styles.title}>{uiText('Text from {value0}', { value0: file.name })}</Text>
            <Text style={styles.muted}>
              {uiText('Extracted on your Studio computer. Check the text before using it.')}
            </Text>
            {!!image && (
              <Image
                source={{ uri: image }}
                accessibilityLabel={file.name}
                resizeMode="contain"
                style={{ width: '100%', height: 220 }}
              />
            )}
            {busy && <ActivityIndicator accessibilityLabel={uiText('Extracting text')} />}
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            {text !== null && (
              <>
                <TextInput
                  multiline
                  accessibilityLabel={uiText('Extracted text')}
                  value={text}
                  onChangeText={setText}
                  style={{
                    minHeight: 140,
                    color: colors.text,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 8,
                    padding: 12,
                    textAlignVertical: 'top',
                  }}
                />
                {!text && <Text>{uiText('No text found.')}</Text>}
              </>
            )}
            {!!error && (
              <Action
                secondary
                label={uiText('Try again')}
                disabled={busy || !connected}
                onPress={() => void extract()}
              />
            )}
            {attachText && (
              <Action
                label={uiText('Attach text file')}
                disabled={busy || disabled || !connected || !text?.trim()}
                onPress={() => {
                  if (!text?.trim()) return
                  setOpen(false)
                  void attachText(
                    text,
                    `${file.name.replace(/\.[^.]+$/, '').slice(0, 220)}-ocr.txt`,
                  ).catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : String(cause))
                    setOpen(true)
                  })
                }}
              />
            )}
            <Action secondary label={uiText('Close')} onPress={() => setOpen(false)} />
          </ScrollView>
        </View>
      </SafeModal>
    </>
  )
}
