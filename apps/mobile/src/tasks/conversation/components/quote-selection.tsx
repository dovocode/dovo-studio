import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRef, useState } from 'react'
import { Platform, TextInput } from 'react-native'
import { Action } from '../../../ui/controls/action'
import { Sheet, type SheetHandle } from '../../../ui/layout/sheet'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import {
  NativeReferenceMessage,
  nativeReferenceMessagesAvailable,
} from '../../composer/native-composer-input'
import type { NativeReferenceMessageProps } from '../../composer/native-composer-input.types'

const references: NativeReferenceMessageProps['references'] = []
const links: NativeReferenceMessageProps['links'] = []
const onLink = () => {}

export function QuoteSelection({
  text,
  messageId,
  onQuote,
  onClose,
}: {
  text: string
  messageId: string
  onQuote: (quote: string) => void
  onClose: () => void
}) {
  const uiText = useInterfaceText()
  const { styles, colors } = useTheme()
  const sheet = useRef<SheetHandle>(null)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const selected = text.slice(selection.start, selection.end)
  return (
    <Sheet
      ref={sheet}
      title={uiText('Quote selection')}
      onClose={onClose}
      footer={
        <Action
          label={uiText('Add quote to draft')}
          disabled={!selected}
          onPress={() => {
            const quote = selected
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n')
            sheet.current?.dismiss(() =>
              onQuote(
                `[Reply to assistant message ${JSON.stringify(messageId)}. Use conversation_read with this messageId for more context.]\n${quote}\n\n`,
              ),
            )
          }}
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
    </Sheet>
  )
}
