import { Modal, type ModalProps, type StyleProp, type ViewStyle } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { styles } from '../theme'

/** A modal is a separate native surface and must measure its own safe area. */
export function SafeModal({
  children,
  contentStyle,
  ...props
}: ModalProps & { contentStyle?: StyleProp<ViewStyle> }) {
  return (
    <Modal {...props}>
      <SafeAreaProvider>
        <SafeAreaView style={[styles.screen, contentStyle]}>{children}</SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  )
}
