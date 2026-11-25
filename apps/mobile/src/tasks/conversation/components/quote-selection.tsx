import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useId, useRef, useState } from 'react'
import { responseSelectionReply } from '@dovo/protocol'
import { Platform, TextInput } from 'react-native'
import { useRuntime } from '../../../runtime/connection/provider'
import { Action } from '../../../ui/controls/action'
import { Field } from '../../../ui/controls/field'
import { Sheet, type SheetHandle } from '../../../ui/layout/sheet'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import {
  NativeReferenceMessage,
  nativeReferenceMessagesAvailable,
} from '../../composer/native-composer-input'
import type { NativeReferenceMessageProps } from '../../composer/native-composer-input.types'
import { useComposerDictation } from '../../composer/use-composer-dictation'

const references: NativeReferenceMessageProps['references'] = []
const links: NativeReferenceMessageProps['links'] = []
const onLink = () => {}

export function QuoteSelection({
  text,
  messageId,
  taskId,
  onQuote,
  onClose,
}: {
  text: string
  messageId: string
  taskId: string
  onQuote: (quote: string) => void
  onClose: () => void
}) {
  const uiText = useInterfaceText()
  const { styles, colors } = useTheme()
  const { connected } = useRuntime()
  const quoteId = useId()
  const sheet = useRef<SheetHandle>(null)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [comment, setComment] = useState('')
  const [commentSelection, setCommentSelection] = useState<{ start: number; end: number }>()
  const selected = text.slice(selection.start, selection.end)
  const dictation = useComposerDictation({
    taskId,
    title: uiText('Comment on selected text'),
    editing: false,
    draftKey: `quote-${quoteId}`,
    draft: { text: comment, update: setComment },
    connected,
    transient: true,
  })
  return (
    <Sheet
      ref={sheet}
      title={uiText('Quote selection')}
      onClose={onClose}
      footer={
        <Action
          label={uiText('Add quote to draft')}
          disabled={!selected.trim() || dictation.active}
          onPress={() =>
            sheet.current?.dismiss(() =>
              onQuote(responseSelectionReply(messageId, selected, comment)),
            )
          }
        />
      }
    >
      <Text style={styles.muted}>{uiText('Select the text you want to quote.')}</Text>
      {nativeReferenceMessagesAvailable ? (
        <NativeReferenceMessage
          text={text}
          references={references}
          links={links}
          onLink={onLink}
          onSelectionChange={setSelection}
        />
      ) : Platform.OS === 'web' ? (
        <textarea
          aria-label={uiText('Response text')}
          readOnly
          rows={10}
          value={text}
          style={{ width: '100%', color: colors.text, backgroundColor: colors.background }}
          onSelect={({ currentTarget }) =>
            setSelection({ start: currentTarget.selectionStart, end: currentTarget.selectionEnd })
          }
        />
      ) : (
        <TextInput
          accessibilityLabel={uiText('Response text')}
          multiline
          readOnly
          value={text}
          onSelectionChange={({ nativeEvent }) => setSelection(nativeEvent.selection)}
          style={styles.chatText}
        />
      )}
      <Field
        label={uiText('Comment on selected text')}
        value={comment}
        multiline
        editable={!dictation.active}
        onChangeText={(value) => dictation.update(value, 'keyboard')}
        onSelectionChange={({ nativeEvent }) => setCommentSelection(nativeEvent.selection)}
      />
      {dictation.available && (
        <Action
          secondary
          label={dictation.isRecording ? uiText('Stop dictation') : uiText('Dictate comment')}
          disabled={!selected.trim() || dictation.isStarting || dictation.isStopping}
          onPress={() => {
            if (dictation.isRecording) dictation.stop()
            else void dictation.start(commentSelection)
          }}
        />
      )}
      {!!dictation.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {dictation.error}
        </Text>
      )}
    </Sheet>
  )
}
