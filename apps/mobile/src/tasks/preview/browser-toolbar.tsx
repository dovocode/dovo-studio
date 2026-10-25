import { type ComponentRef, type Ref } from 'react'
import { type TextInput, View, StyleSheet } from 'react-native'
import { previewPresets } from '@dovo/protocol'
import { useApplicationState } from '../../runtime/state/application-state'
import { Glass } from '../../ui/layout/glass'
import { Icon } from '../../ui/controls/icon'
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

/** Native and host-rendered pages share navigation, touch targets and options. */
export function BrowserToolbar({
  address,
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
  onEditing?: (editing: boolean) => void
}) {
  const { colors, mode, highContrast } = useTheme()
  const [focused, setFocused] = useApplicationState(false)
  return (
    <View
      accessibilityLabel="Browser navigation"
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        gap: 4,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Glass
        interactive
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 48,
          height: 48,
          flexShrink: 0,
          overflow: 'hidden',
          borderRadius: 24,
          borderWidth: 1,
          borderColor: focused
            ? colors.accent
            : highContrast
              ? colors.border
              : mode === 'dark'
                ? '#ffffff24'
                : '#ffffffb3',
          ...(highContrast ? { backgroundColor: colors.surface } : {}),
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 8,
          shadowOpacity: mode === 'dark' ? 0.18 : 0.06,
        }}
      >
        <View style={{ width: 44, alignItems: 'center' }}>
          <Icon name="web" size={17} color={colors.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 0, height: 46, overflow: 'hidden' }}>
          <Field
            inputRef={addressRef}
            selectTextOnFocus
            placeholder={focused ? 'Enter website address' : ''}
            style={{
              backgroundColor: 'transparent',
              borderWidth: 0,
              borderRadius: 0,
              minHeight: 0,
              height: 46,
              paddingHorizontal: 0,
              paddingVertical: 0,
              fontSize: 16,
              textAlign: 'left',
              color: focused ? colors.text : 'transparent',
            }}
            label="Preview URL"
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
              {address ? addressLabel(address) : 'Enter website address'}
            </Text>
          </View>
        </View>
        <IconButton
          label="Go to address"
          icon="next"
          disabled={!available || !address.trim()}
          onPress={onNavigate}
        />
      </Glass>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton label="Back" icon="back" disabled={!available || !back} onPress={onBack} />
        <IconButton
          label="Forward"
          icon="next"
          disabled={!available || !forward}
          onPress={onForward}
        />
        <IconButton
          label={available ? 'Reload' : 'Reconnect'}
          icon="refresh"
          disabled={available ? reloadDisabled || !address : !onReconnect}
          onPress={available ? onReload : () => onReconnect?.()}
        />
        {onKeyboard && (
          <IconButton label="Keyboard" icon="keyboard" disabled={!available} onPress={onKeyboard} />
        )}
        {!onKeyboard && onExternal && (
          <IconButton label="Open in default browser" icon="external" onPress={onExternal} />
        )}
        <View style={{ width: 44, height: 44, flexShrink: 0 }}>
          <BrowserMenu
            items={[
              ...(onExternal
                ? [{ id: 'external', name: 'Open in default browser', icon: 'external' as const }]
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
              ...(onExpand ? [{ id: 'expand', name: 'Expand page', icon: 'expand' as const }] : []),
              {
                id: 'screenshot',
                name: 'Take screenshot',
                disabled: !available || screenshotDisabled,
              },
              ...previewPresets.map((item) => ({
                id: item.id,
                name: `Viewport · ${item.name}${preset === item.id ? ' ✓' : ''}`,
                disabled: !available,
              })),
              { id: 'rotate', name: 'Rotate viewport', disabled: !available || preset === 'fill' },
              ...(onDiagnostics ? [{ id: 'diagnostics', name: 'Connection details' }] : []),
              ...(onCloseSession ? [{ id: 'close', name: 'Close browser session' }] : []),
            ]}
            onChange={(value) => {
              if (value === 'screenshot') onScreenshot()
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
      </View>
    </View>
  )
}
