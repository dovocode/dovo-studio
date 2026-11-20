import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import type { DraftPersistence } from '../../runtime/state/detail-drafts'
import { Action } from '../controls/action'
import { useTheme } from '../theme'
import { Text } from './text'

/** Tells the user when the phone does not hold the latest copy of a draft. */
export function DraftStorageNotice({ persistence }: { persistence: DraftPersistence | undefined }) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const status = persistence?.status
  if (!persistence || !status) return null
  const message =
    status === 'read-failed'
      ? uiText('Saved drafts could not be read. They stay on this phone. Retry to load them.')
      : status === 'write-failed'
        ? uiText(
            'This draft is not saved on this phone. Keep the app open until you send it, or retry.',
          )
        : status === 'too-large'
          ? uiText(
              'This draft is too large to save on this phone. Keep the app open until you send it.',
            )
          : status === 'credential'
            ? uiText(
                'This draft contains a credential, so it is not saved on this phone. Keep the app open until you save it.',
              )
            : uiText(
                'A saved draft from another app version could not be opened. Editing replaces it.',
              )
  const retry = status === 'read-failed' || status === 'write-failed'
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="alert" style={styles.error}>
        {message}
      </Text>
      {retry && (
        <Action label={uiText('Retry saving drafts')} secondary onPress={persistence.retry} />
      )}
    </View>
  )
}
