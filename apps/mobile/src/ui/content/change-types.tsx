import { changeTypeDistribution, type ChangeTypeFile, type FileKind } from '@dovo/protocol'
import { Pressable, View } from 'react-native'
import { useTheme } from '../theme'
import { Text } from './text'

const categories: { kind: FileKind; label: string; light: string; dark: string }[] = [
  { kind: 'normal', label: 'Code', light: '#0369a1', dark: '#38bdf8' },
  { kind: 'tests', label: 'Tests', light: '#065f46', dark: '#34d399' },
  { kind: 'mocks', label: 'Mocks', light: '#6d28d9', dark: '#c4b5fd' },
  { kind: 'docs', label: 'Docs', light: '#92400e', dark: '#fbbf24' },
  { kind: 'generated', label: 'Generated', light: '', dark: '' },
]

export function ChangeTypeIndicator({ kind }: { kind: FileKind }) {
  const { mode, colors } = useTheme()
  const category = categories.find((category) => category.kind === kind)!
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={category.label}
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        flexShrink: 0,
        backgroundColor: category[mode] || colors.muted,
      }}
    />
  )
}

export function ChangeTypeFilters({
  files,
  value,
  onChange,
  total,
  weightBy = 'files',
}: {
  files: readonly ChangeTypeFile[]
  value?: FileKind
  onChange: (kind: FileKind | undefined) => void
  total?: number | null
  weightBy?: 'files' | 'lines'
}) {
  const { mode, colors, styles } = useTheme()
  const { counts, weights, unit, total: amount } = changeTypeDistribution(files, weightBy)
  return (
    <View style={{ gap: 2 }}>
      {!!files.length && (
        <View
          style={{ flexDirection: 'row', gap: 2 }}
          accessibilityLabel={
            unit === 'lines' ? 'Changed line distribution' : 'File type distribution'
          }
        >
          {categories
            .filter(({ kind }) => (weights.get(kind) ?? 0) > 0)
            .map((category) => (
              <Pressable
                key={category.kind}
                accessibilityRole="button"
                accessibilityLabel={`Filter ${category.label}: ${counts.get(category.kind)} files${unit === 'lines' ? `, ${weights.get(category.kind)} of ${amount} changed lines` : ''}`}
                accessibilityState={{ selected: value === category.kind }}
                onPress={() => onChange(value === category.kind ? undefined : category.kind)}
                style={{
                  flexGrow: weights.get(category.kind),
                  flexBasis: 0,
                  minWidth: unit === 'lines' ? 0 : 44,
                  minHeight: 44,
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: category[mode] || colors.muted,
                    opacity: value && value !== category.kind ? 0.3 : 1,
                  }}
                />
              </Pressable>
            ))}
        </View>
      )}
      <View
        accessibilityLabel="Change types"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}
      >
        {[
          { kind: undefined, label: 'All', count: files.length, color: colors.text },
          ...categories
            .filter(({ kind }) => counts.has(kind) || value === kind)
            .map((category) => ({
              ...category,
              count: counts.get(category.kind) ?? 0,
              color: category[mode] || colors.muted,
            })),
        ].map(({ kind, label, count, color }) => (
          <Pressable
            key={kind ?? 'all'}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${count}`}
            accessibilityState={{ selected: value === kind }}
            onPress={() => onChange(value === kind ? undefined : kind)}
            style={{
              minHeight: 44,
              paddingHorizontal: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: value === kind ? colors.border : 'transparent',
              backgroundColor: value === kind ? colors.selection : 'transparent',
            }}
          >
            {kind && <ChangeTypeIndicator kind={kind} />}
            <Text
              style={{
                color,
                fontSize: 12,
                fontWeight: value === kind ? '600' : '400',
                fontVariant: ['tabular-nums'],
              }}
            >
              {label} {count}
            </Text>
          </Pressable>
        ))}
        {total != null && total > files.length && (
          <Text style={styles.muted}>
            ({files.length} of {total} files loaded)
          </Text>
        )}
      </View>
    </View>
  )
}
