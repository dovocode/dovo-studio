import { pullFileKind, type FileKind } from '@dovo/protocol'
import { Pressable, View } from 'react-native'
import { useTheme } from '../theme'
import { Text } from './text'

const categories: { kind: FileKind; label: string; light: string; dark: string }[] = [
  { kind: 'normal', label: 'Code', light: '#0369a1', dark: '#38bdf8' },
  { kind: 'tests', label: 'Tests', light: '#047857', dark: '#34d399' },
  { kind: 'mocks', label: 'Mocks', light: '#7c3aed', dark: '#a78bfa' },
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
}: {
  files: readonly (Parameters<typeof pullFileKind>[0] & { changeKind?: FileKind })[]
  value?: FileKind
  onChange: (kind: FileKind | undefined) => void
  total?: number | null
}) {
  const { mode, colors, styles } = useTheme()
  const counts = new Map<FileKind, number>()
  for (const file of files) {
    const kind = file.changeKind ?? pullFileKind(file)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return (
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
            paddingHorizontal: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: value === kind ? colors.border : 'transparent',
            backgroundColor: value === kind ? colors.selection : 'transparent',
          }}
        >
          {kind && <ChangeTypeIndicator kind={kind} />}
          <Text style={{ color, fontSize: 12, fontVariant: ['tabular-nums'] }}>
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
  )
}
