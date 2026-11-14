import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Glass } from '../ui/layout/glass'
import { IconButton } from '../ui/controls/icon-button'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

/** A single glass row leaves the page and native app tabs their own space. */
export function BrowserNavigation({
  address,
  onAddress,
  onEditing,
  onNavigate,
  changed,
  back,
  forward,
  onBack,
  onForward,
  disabled,
  tabs,
  onTabs,
  onOptions,
}: {
  address: string
  onAddress: (address: string) => void
  onEditing: (editing: boolean) => void
  onNavigate: () => void
  changed: boolean
  back: boolean
  forward: boolean
  onBack: () => void
  onForward: () => void
  disabled: boolean
  tabs: number
  onTabs: () => void
  onOptions: () => void
}) {
  const uiText = useInterfaceText()

  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  let domain = address
  try {
    domain = new URL(address).host || address
  } catch {
    // Search text and incomplete addresses stay visible before navigation.
  }
  return (
    <View
      accessibilityLabel={uiText('Browser navigation')}
      style={{ paddingHorizontal: 8, paddingVertical: 6 }}
    >
      <Glass
        testID="Browser navigation surface"
        style={{
          borderRadius: 28,
          paddingHorizontal: 4,
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 52,
        }}
      >
        <IconButton label={uiText('Browser options')} icon="more" onPress={onOptions} />
        {!focused && (
          <>
            <IconButton
              label={uiText('Back')}
              icon="back"
              disabled={disabled || !back}
              onPress={onBack}
            />
            <IconButton
              label={uiText('Forward')}
              icon="next"
              disabled={disabled || !forward}
              onPress={onForward}
            />
          </>
        )}
        <View style={{ flex: 1, minWidth: 0, height: 44, justifyContent: 'center' }}>
          <TextInput
            accessibilityLabel={uiText('Search or enter address')}
            testID="Search or enter address"
            placeholder={uiText('Search or enter address')}
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            value={address}
            onChangeText={onAddress}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            selectTextOnFocus
            keyboardType="web-search"
            returnKeyType="go"
            onSubmitEditing={onNavigate}
            onFocus={() => {
              setFocused(true)
              onEditing(true)
            }}
            onBlur={() => {
              setFocused(false)
              onEditing(false)
            }}
            style={{
              height: 44,
              minWidth: 0,
              fontSize: 16,
              textAlign: 'center',
              color: focused ? colors.text : 'transparent',
              paddingHorizontal: 0,
              paddingVertical: 8,
            }}
            caretHidden={!focused}
          />
          {!focused && (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0 }}>
              <Text
                numberOfLines={1}
                style={{ color: colors.text, fontSize: 16, textAlign: 'center' }}
              >
                {domain || uiText('Search or enter address')}
              </Text>
            </View>
          )}
        </View>
        <IconButton
          label={changed ? uiText('Go') : uiText('Reload')}
          icon={changed ? 'next' : 'refresh'}
          disabled={disabled || !address.trim()}
          onPress={onNavigate}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uiText('Tabs ({value0})', { value0: tabs })}
          onPress={onTabs}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <View
            style={{
              borderWidth: 1.5,
              borderColor: colors.text,
              borderRadius: 6,
              minWidth: 23,
              height: 25,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{tabs}</Text>
          </View>
        </Pressable>
      </Glass>
    </View>
  )
}
