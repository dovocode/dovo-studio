import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { type ComponentRef, type Ref } from 'react'
import { type TextInput, View } from 'react-native'
import { previewPresets } from '@dovo/protocol'
import { useApplicationState } from '../../runtime/state/application-state'
import { Glass } from '../../ui/layout/glass'
import { Text } from '../../ui/content/text'
import { Field } from '../../ui/controls/field'
import { IconButton } from '../../ui/controls/icon-button'
import { useTheme } from '../../ui/theme'
import { BrowserMenu } from './browser-menu'

export type BrowserMode = 'remote' | 'web'

function addressLabel(address: string) {
  try {
    return new URL(address).host || address
  } catch {
    return address
  }
}

/** Native and host-rendered pages use the same navigation row. */
export function BrowserToolbar({
  address,
  context,
  changed,
  onAddress,
  onNavigate,
  back,
  forward,
  onBack,
  onForward,
  onReload,
  preset,
  onPreset,
  onRotate,
  onScreenshot,
  screenshotDisabled = false,
  reloadDisabled = false,
  onKeyboard,
  onExternal,
  available = true,
  onReconnect,
  reconnectLabel,
  onEditing,
  onCloseSession,
  onDiagnostics,
  addressRef,
  mode: browserMode,
  onMode,
  onExpand,
}: {
  mode?: BrowserMode
  onMode?: (mode: BrowserMode) => void
  onExpand?: () => void
  addressRef?: Ref<ComponentRef<typeof TextInput>>
  onCloseSession?: () => void
  onDiagnostics?: () => void
  address: string
  context?: string
  changed: boolean
  onAddress: (value: string) => void
  onNavigate: () => void
  back: boolean
  forward: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  preset: string
  onPreset: (value: string) => void
  onRotate: () => void
  onScreenshot: () => void
  screenshotDisabled?: boolean
  reloadDisabled?: boolean
  onKeyboard?: () => void
  onExternal?: () => void
  available?: boolean
  onReconnect?: () => void
  reconnectLabel?: string
  onEditing?: (editing: boolean) => void
}) {
  const uiText = useInterfaceText()

  const { colors, highContrast } = useTheme()
  const [focused, setFocused] = useApplicationState(false)
  return (
    <View
      accessibilityLabel={uiText('Browser navigation')}
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      {context && <Text style={{ color: colors.muted, paddingHorizontal: 8 }}>{context}</Text>}
      <Glass
        solid
        testID="Browser toolbar surface"
        style={{
          borderRadius: 28,
          paddingHorizontal: 4,
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 52,
        }}
      >
        <IconButton
          label={uiText('Back')}
          icon="back"
          disabled={!available || !back}
          onPress={onBack}
        />
        <View
          style={{
            flex: 1,
            minWidth: 0,
            justifyContent: 'center',
            height: 44,
            overflow: 'hidden',
            borderRadius: 22,
            borderWidth: 1,
            borderColor: focused ? colors.accent : colors.border,
            ...(highContrast ? { backgroundColor: colors.surface } : {}),
          }}
        >
          <Field
            inputRef={addressRef}
            selectTextOnFocus
            placeholder={focused ? uiText('Enter website address') : ''}
            style={{
              backgroundColor: 'transparent',
              borderWidth: 0,
              borderRadius: 0,
              minHeight: 0,
              height: 46,
              paddingHorizontal: 8,
              paddingVertical: 0,
              fontSize: 16,
              textAlign: 'center',
              color: focused ? colors.text : 'transparent',
            }}
            label={uiText('Preview URL')}
            hideLabel
            value={address}
            multiline={false}
            numberOfLines={1}
            caretHidden={!focused}
            onChangeText={onAddress}
            editable={available}
            keyboardType="url"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="go"
            onSubmitEditing={onNavigate}
            onFocus={() => {
              setFocused(true)
              onEditing?.(true)
            }}
            onBlur={() => {
              setFocused(false)
              onEditing?.(false)
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              inset: 0,
              justifyContent: 'center',
              opacity: focused ? 0 : 1,
            }}
          >
            <Text
              accessible={false}
              numberOfLines={1}
              ellipsizeMode="middle"
              style={{
                color: address ? colors.text : colors.muted,
                fontSize: 16,
                textAlign: 'center',
              }}
            >
              {address ? addressLabel(address) : uiText('Enter website address')}
            </Text>
          </View>
        </View>
        <IconButton
          label={
            !available
              ? (reconnectLabel ?? uiText('Reconnect'))
              : changed
                ? uiText('Go to address')
                : uiText('Reload')
          }
          icon={changed && available ? 'next' : 'refresh'}
          disabled={
            available ? (changed ? !address.trim() : reloadDisabled || !address) : !onReconnect
          }
          onPress={!available ? () => onReconnect?.() : changed ? onNavigate : onReload}
        />
        {onKeyboard && (
          <IconButton
            label={uiText('Keyboard')}
            icon="keyboard"
            disabled={!available}
            onPress={onKeyboard}
          />
        )}
        <View style={{ width: 44, height: 44, flexShrink: 0 }}>
          <BrowserMenu
            items={[
              ...(forward && available
                ? [{ id: 'forward', name: uiText('Forward'), icon: 'next' as const }]
                : []),
              ...(onExternal
                ? [
                    {
                      id: 'external',
                      name: uiText('Open in default browser'),
                      icon: 'external' as const,
                    },
                  ]
                : []),
              ...(onMode && browserMode
                ? [
                    {
                      id: 'mode',
                      name: browserMode === 'remote' ? 'Browse on this device' : 'Browse on host',
                      icon: 'web' as const,
                    },
                  ]
                : []),
              ...(onExpand
                ? [{ id: 'expand', name: uiText('Expand page'), icon: 'expand' as const }]
                : []),
              {
                id: 'screenshot',
                name: uiText('Take screenshot'),
                disabled: !available || screenshotDisabled,
              },
              ...previewPresets.map((item) => ({
                id: item.id,
                name: `Viewport · ${item.name}${preset === item.id ? ' ✓' : ''}`,
                disabled: !available,
              })),
              {
                id: 'rotate',
                name: uiText('Rotate viewport'),
                disabled: !available || preset === 'fill',
              },
              ...(onDiagnostics ? [{ id: 'diagnostics', name: uiText('Connection details') }] : []),
              ...(onCloseSession ? [{ id: 'close', name: uiText('Close browser session') }] : []),
            ]}
            onChange={(value) => {
              if (value === 'forward') onForward()
              else if (value === 'screenshot') onScreenshot()
              else if (value === 'rotate') onRotate()
              else if (value === 'external') onExternal?.()
              else if (value === 'mode') onMode?.(browserMode === 'remote' ? 'web' : 'remote')
              else if (value === 'expand') onExpand?.()
              else if (value === 'diagnostics') onDiagnostics?.()
              else if (value === 'close') onCloseSession?.()
              else if (previewPresets.some((item) => item.id === value)) onPreset(value)
            }}
          />
        </View>
      </Glass>
    </View>
  )
}
