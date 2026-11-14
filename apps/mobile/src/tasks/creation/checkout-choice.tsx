import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { Pressable, View } from 'react-native'
import { Icon } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function CheckoutChoice({
  value,
  disabled,
  branch,
  onChange,
}: {
  value: 'main' | 'worktree' | 'existing'
  disabled: boolean
  branch?: string
  onChange: (value: 'main' | 'worktree' | 'existing') => void
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  return (
    <View style={{ gap: 8 }} accessibilityLabel={uiText('Working directory')}>
      {(['main', 'worktree', 'existing'] as const).map((mode) => {
        const selected = value === mode
        return (
          <Pressable
            key={mode}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(mode)}
            style={({ pressed }) => [
              styles.card,
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 76,
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: pressed || selected ? colors.elevated : colors.surface,
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          >
            <Icon
              name={mode === 'main' ? 'folder' : 'changes'}
              size={24}
              color={selected ? colors.accent : colors.muted}
            />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.text, { fontWeight: '600' }]}>
                {mode === 'main'
                  ? uiText('Local checkout')
                  : mode === 'worktree'
                    ? uiText('New worktree')
                    : uiText('Existing worktree')}
              </Text>
              <Text style={styles.muted}>
                {mode === 'main'
                  ? uiText('Work in {value0}, including local changes.', {
                      value0: branch || 'the current branch',
                    })
                  : mode === 'worktree'
                    ? uiText('A separate folder and branch. Keep your current checkout untouched.')
                    : uiText('Use its current branch and uncommitted files.')}
              </Text>
            </View>
            {selected && <Icon name="check" size={18} color={colors.accent} />}
          </Pressable>
        )
      })}
      {value === 'worktree' && (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Created when you send. The branch name comes from your AI-generated task title.'}
          </InterfaceText>
        </Text>
      )}
    </View>
  )
}
