import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { ChangedFile } from '@dovo/protocol'
import { fileStats, checkpointFolders } from '../../files/stats'
import { Text } from '../../../ui/content/text'
import { Icon } from '../../../ui/controls/icon'
import { colors, styles } from '../../../ui/theme'

function Amounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <>
      <Text style={{ color: '#34d399', fontSize: 12 }}>+{additions}</Text>
      <Text style={{ color: '#fb7185', fontSize: 12 }}>-{deletions}</Text>
    </>
  )
}
export function CheckpointFiles({
  files,
  omitted,
  onOpen,
}: {
  files: ChangedFile[]
  omitted: string[]
  onOpen: (path: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const stats = new Map(files.map((file) => [file.path, fileStats(file)]))
  const groups = checkpointFolders([...files.map((file) => file.path), ...omitted])
  const row = (path: string) => {
    const counts = stats.get(path)
    return (
      <Pressable
        key={path}
        accessibilityRole="button"
        accessibilityLabel={`Open diff for ${path}`}
        onPress={() => onOpen(path)}
        style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Icon name="changes" size={14} color={colors.muted} />
        <Text numberOfLines={1} style={[styles.muted, { flex: 1, fontSize: 12 }]}>
          {path.split('/').at(-1)}
        </Text>
        {counts && <Amounts {...counts} />}
      </Pressable>
    )
  }
  return (
    <View>
      {(groups.get('') ?? []).map(row)}
      {[...groups]
        .filter(([folder]) => !!folder)
        .map(([folder, paths]) => {
          const totals = paths.reduce(
            (sum, path) => ({
              additions: sum.additions + (stats.get(path)?.additions ?? 0),
              deletions: sum.deletions + (stats.get(path)?.deletions ?? 0),
            }),
            { additions: 0, deletions: 0 },
          )
          return (
            <View key={folder}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={folder}
                accessibilityState={{ expanded: !!expanded[folder] }}
                onPress={() =>
                  setExpanded((current) => ({ ...current, [folder]: !current[folder] }))
                }
                style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <Icon name={expanded[folder] ? 'down' : 'next'} size={12} color={colors.muted} />
                <Icon name="folder" size={14} color={colors.muted} />
                <Text numberOfLines={1} style={[styles.muted, { flex: 1, fontSize: 12 }]}>
                  {folder}
                </Text>
                <Amounts {...totals} />
              </Pressable>
              {expanded[folder] && <View style={{ paddingLeft: 24 }}>{paths.map(row)}</View>}
            </View>
          )
        })}
    </View>
  )
}
