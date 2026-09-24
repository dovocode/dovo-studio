import { Pressable, View } from 'react-native'
import { Icon } from '../ui/icon'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'

export function CheckoutChoice({
  value,
  disabled,
  branch,
  onChange,
}: {
  value: 'main' | 'worktree'
  disabled: boolean
  branch?: string
  onChange: (value: 'main' | 'worktree') => void
}) {
  return (
    <View style={{ gap: 8 }} accessibilityLabel="Working directory">
      {(['main', 'worktree'] as const).map((mode) => {
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
                {mode === 'main' ? 'Local checkout' : 'New worktree'}
              </Text>
              <Text style={styles.muted}>
                {mode === 'main'
                  ? `Work in ${branch || 'the current branch'}, including local changes.`
                  : 'A separate folder and branch. Keep your current checkout untouched.'}
              </Text>
            </View>
            {selected && <Icon name="check" size={18} color={colors.accent} />}
          </Pressable>
        )
      })}
      {value === 'worktree' && (
        <Text style={styles.muted}>
          Created when you send. The branch name comes from your AI-generated task title.
        </Text>
      )}
    </View>
  )
}
