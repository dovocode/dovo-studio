import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { contentColumn } from './content-column'
import { ValidationFields } from '../controls/validation-fields'
import { SafeModal } from './safe-modal'
import { Glass } from './glass'
import { designTokens } from '@dovo/design'
import { NativeIcon, NativeMenuButton } from '../controls/native-icon'
import { useApplicationState } from '../../runtime/state/application-state'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type Ref,
} from 'react'
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
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native'
import { Text } from '../content/text'
import { IconButton } from '../controls/icon-button'
import type { IconName } from '../controls/icon'
import { useTheme } from '../theme'
const SheetContext = createContext(false)
const SheetNavigationContext = createContext<(navigate: () => void) => void>((navigate) =>
  navigate(),
)
export type SheetHandle = { dismiss: (after?: () => void) => void }
/** Navigate only after the containing native presentations have finished dismissing. */
export function useSheetNavigation() {
  return useContext(SheetNavigationContext)
}
export function useInsideSheet() {
  return useContext(SheetContext)
}
export function Sheet({
  title,
  ref,
  children,
  onClose,
  busy = false,
  scrollable = true,
  footer,
  headerAction,
  presentation = 'sheet',
  validationAttempt,
  scrollViewProps,
}: {
  title: string
  ref?: Ref<SheetHandle>
  children: ReactNode
  onClose: () => void
  busy?: boolean
  scrollable?: boolean
  presentation?: 'sheet' | 'dialog'
  validationAttempt?: number
  scrollViewProps?: Pick<
    React.ComponentPropsWithRef<typeof ScrollView>,
    'ref' | 'onScroll' | 'scrollEventThrottle' | 'onContentSizeChange'
  >
  footer?: ReactNode
  headerAction?: { label: string; icon: IconName; onPress: () => void; disabled?: boolean }
}) {
  const uiText = useInterfaceText()

  const { colors, styles, mode: appearanceMode } = useTheme()

  const [presented, setPresented] = useApplicationState(true)
  const [keyboard, setKeyboard] = useApplicationState(false)
  const closed = useRef(false)
  const dismissing = useRef(false)
  const afterDismiss = useRef<(() => void) | undefined>(undefined)
  const parentNavigate = useSheetNavigation()
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
    afterDismiss.current?.()
  }, [])
  const dismiss = (after?: () => void) => {
    if (closed.current || dismissing.current) return
    dismissing.current = true
    afterDismiss.current = after
    Keyboard.dismiss()
    setPresented(false)
    if (Platform.OS !== 'ios') finishClose()
  }
  useImperativeHandle(ref, () => ({ dismiss }))
  const close = () => {
    if (!busy) dismiss()
  }
  const navigate = (action: () => void) => {
    if (!busy) dismiss(() => parentNavigate(action))
  }
  const content = (
    <SheetContext.Provider value>
      <SheetNavigationContext.Provider value={navigate}>
        <ValidationFields validationAttempt={validationAttempt}>{children}</ValidationFields>
      </SheetNavigationContext.Provider>
    </SheetContext.Provider>
  )
  if (presentation === 'dialog')
    return (
      <SafeModal
        visible={presented}
        transparent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={close}
        onDismiss={finishClose}
        contentStyle={{ backgroundColor: 'transparent' }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}
        >
          <Pressable
            accessibilityLabel={uiText('Dismiss {value0}', { value0: title })}
            accessibilityRole="button"
            disabled={busy}
            onPress={close}
            style={{ position: 'absolute', inset: 0, backgroundColor: '#00000080' }}
          />
          <Glass
            solid
            role="dialog"
            accessibilityLabel={title}
            accessibilityViewIsModal
            style={{
              width: '100%',
              maxWidth: 440,
              maxHeight: '85%',
              borderRadius: designTokens.radius.overlay,
              padding: 20,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text accessibilityRole="header" style={[styles.title, { flex: 1, minWidth: 0 }]}>
                {title}
              </Text>
              {headerAction && (
                <IconButton {...headerAction} disabled={busy || !!headerAction.disabled} />
              )}
              <IconButton
                label={uiText('Close')}
                icon="close"
                variant="plain"
                disabled={busy}
                onPress={close}
              />
            </View>
            {scrollable ? (
              <ScrollView
                {...scrollViewProps}
                style={{ flexGrow: 0, flexShrink: 1 }}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[contentColumn.form, { gap: 12 }]}
              >
                {content}
              </ScrollView>
            ) : (
              content
            )}
            {footer}
          </Glass>
        </KeyboardAvoidingView>
      </SafeModal>
    )
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
                        {...scrollViewProps}
                        keyboardDismissMode="interactive"
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={[
                          styles.content,
                          contentColumn.form,
                          {
                            paddingTop: 12,
                            paddingBottom: 24,
                          },
                        ]}
                      >
                        {content}
                      </ScrollView>
                    ) : (
                      <View
                        style={{
                          flex: 1,
                        }}
                      >
                        {content}
                      </View>
                    )}
                    {footer && (
                      <View style={[styles.sheetFooter, contentColumn.form]}>{footer}</View>
                    )}
                  </View>
                </RNHostView>
                <Toolbar.Content>
                  {headerAction && (
                    <NativeMenuButton
                      testID={headerAction.label}
                      label={headerAction.label}
                      icon={headerAction.icon}
                      onPress={headerAction.onPress}
                      modifiers={[
                        labelStyle('iconOnly'),
                        accessibilityLabel(headerAction.label),
                        disabled(busy || !presented || !!headerAction.disabled),
                      ]}
                    />
                  )}
                  {keyboard && (
                    <NativeMenuButton
                      testID="Dismiss keyboard"
                      label={uiText('Dismiss keyboard')}
                      icon="keyboard"
                      onPress={() => Keyboard.dismiss()}
                      modifiers={[
                        labelStyle('iconOnly'),
                        accessibilityLabel(uiText('Dismiss keyboard')),
                      ]}
                    />
                  )}
                  <Button
                    testID="Close"
                    role="close"
                    onPress={() => close()}
                    modifiers={[disabled(busy || !presented), accessibilityLabel(uiText('Close'))]}
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
    <SafeModal visible={presented} animationType="slide" onRequestClose={() => close()}>
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
                  minWidth: 0,
                },
              ]}
            >
              {title}
            </Text>
            <View style={{ width: 44, height: 44, flexShrink: 0 }}>
              {keyboard && (
                <IconButton
                  label={uiText('Dismiss keyboard')}
                  icon="keyboard"
                  onPress={() => Keyboard.dismiss()}
                />
              )}
            </View>
            {headerAction && (
              <IconButton
                label={headerAction.label}
                icon={headerAction.icon}
                onPress={headerAction.onPress}
                disabled={busy || !!headerAction.disabled}
              />
            )}
            <IconButton
              label={uiText('Close')}
              icon="close"
              variant="glass"
              disabled={busy}
              onPress={close}
            />
          </View>
          {scrollable ? (
            <ScrollView
              {...scrollViewProps}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.content,
                contentColumn.form,
                {
                  paddingTop: 4,
                },
              ]}
            >
              {content}
            </ScrollView>
          ) : (
            <View
              style={{
                flex: 1,
              }}
            >
              {content}
            </View>
          )}
          {footer && <View style={[styles.sheetFooter, contentColumn.form]}>{footer}</View>}
        </KeyboardAvoidingView>
      </View>
    </SafeModal>
  )
}
