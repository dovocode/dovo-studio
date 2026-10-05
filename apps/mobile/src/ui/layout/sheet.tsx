import { SafeModal } from './safe-modal'
import { NativeIcon, NativeMenuButton } from '../controls/native-icon'
import { useApplicationState } from '../../runtime/state/application-state'
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import {
  BottomSheet,
  Button,
  Group,
  Host,
  NavigationStack,
  RNHostView,
  Toolbar,
} from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  disabled,
  interactiveDismissDisabled,
  labelStyle,
  navigationTitle,
  navigationBarTitleDisplayMode,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers'
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { Text } from '../content/text'
import { Action } from '../controls/action'
import { useTheme } from '../theme'
const SheetContext = createContext(false)
export function useInsideSheet() {
  return useContext(SheetContext)
}
export function Sheet({
  title,
  children,
  onClose,
  busy = false,
  scrollable = true,
  footer,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
  scrollable?: boolean
  footer?: ReactNode
}) {
  const { colors, styles, mode: appearanceMode } = useTheme()

  const [presented, setPresented] = useApplicationState(true)
  const [keyboard, setKeyboard] = useApplicationState(false)
  const closed = useRef(false)
  const closeCallback = useRef(onClose)
  closeCallback.current = onClose
  useEffect(() => {
    // Opening a sheet must release the field on the screen underneath it.
    Keyboard.dismiss()
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  const finishClose = useCallback(() => {
    if (closed.current) return
    closed.current = true
    closeCallback.current()
  }, [])
  const close = () => {
    if (busy || closed.current) return
    Keyboard.dismiss()
    setPresented(false)
    if (Platform.OS !== 'ios') finishClose()
  }
  if (Platform.OS === 'ios')
    return (
      <Host
        colorScheme={appearanceMode}
        seedColor={colors.accent}
        style={{
          position: 'absolute',
        }}
        pointerEvents="none"
      >
        <BottomSheet
          isPresented={presented}
          onIsPresentedChange={setPresented}
          // Keep the presenter mounted until UIKit finishes dismissing, so a close callback
          // can safely open the next sheet instead of racing the outgoing presentation.
          onDismiss={finishClose}
        >
          <Group
            modifiers={[
              presentationDetents(['large']),
              presentationDragIndicator('visible'),
              interactiveDismissDisabled(busy),
            ]}
          >
            <NavigationStack>
              <Toolbar
                modifiers={[navigationTitle(title), navigationBarTitleDisplayMode('inline')]}
              >
                <RNHostView>
                  <View
                    style={{
                      flexGrow: 1,
                      height: 0,
                    }}
                  >
                    {scrollable ? (
                      <ScrollView
                        keyboardDismissMode="interactive"
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={[
                          styles.content,
                          {
                            paddingTop: 12,
                            paddingBottom: 24,
                          },
                        ]}
                      >
                        <SheetContext.Provider value>{children}</SheetContext.Provider>
                      </ScrollView>
                    ) : (
                      <View
                        style={{
                          flex: 1,
                        }}
                      >
                        <SheetContext.Provider value>{children}</SheetContext.Provider>
                      </View>
                    )}
                    {footer && <View style={styles.sheetFooter}>{footer}</View>}
                  </View>
                </RNHostView>
                <Toolbar.Content>
                  {keyboard && (
                    <NativeMenuButton
                      testID="Dismiss keyboard"
                      label="Dismiss keyboard"
                      icon="keyboard"
                      onPress={Keyboard.dismiss}
                      modifiers={[labelStyle('iconOnly'), accessibilityLabel('Dismiss keyboard')]}
                    />
                  )}
                  <Button
                    testID="Close"
                    role="close"
                    onPress={close}
                    modifiers={[disabled(busy || !presented), accessibilityLabel('Close')]}
                  >
                    <NativeIcon name="close" color={colors.text} />
                  </Button>
                </Toolbar.Content>
              </Toolbar>
            </NavigationStack>
          </Group>
        </BottomSheet>
      </Host>
    )
  return (
    <SafeModal visible={presented} animationType="slide" onRequestClose={close}>
      <View style={styles.screen}>
        <KeyboardAvoidingView style={styles.screen} behavior="height">
          <View
            style={[
              styles.content,
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              },
            ]}
          >
            <Text
              accessibilityRole="header"
              style={[
                styles.title,
                {
                  flex: 1,
                },
              ]}
            >
              {title}
            </Text>
            {keyboard && <Action label="Dismiss keyboard" secondary onPress={Keyboard.dismiss} />}
            <Action label="Close" secondary disabled={busy} onPress={close} />
          </View>
          {scrollable ? (
            <ScrollView
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.content,
                {
                  paddingTop: 4,
                },
              ]}
            >
              <SheetContext.Provider value>{children}</SheetContext.Provider>
            </ScrollView>
          ) : (
            <View
              style={{
                flex: 1,
              }}
            >
              <SheetContext.Provider value>{children}</SheetContext.Provider>
            </View>
          )}
          {footer && <View style={styles.sheetFooter}>{footer}</View>}
        </KeyboardAvoidingView>
      </View>
    </SafeModal>
  )
}
