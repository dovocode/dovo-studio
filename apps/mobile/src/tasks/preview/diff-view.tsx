import { useMemo, useState } from 'react'
import { FlatList, ScrollView, Switch, View, useWindowDimensions } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { diffRows, type DiffRow } from './diff-lines'
// Android: upstream react-native-diffs only implements the iOS renderer.
export function DiffView({ patch }: { patch: string }) {
  const { colors, styles } = useTheme()
  const { width } = useWindowDimensions()
  const [wrap, setWrap] = useState(false)
  const rows = useMemo(() => diffRows(patch), [patch])
  const contentWidth = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.text.length * 8 + 92), width),
    [rows, width],
  )
  const render = ({ item }: { item: DiffRow }) => (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor:
          item.kind === 'addition'
            ? `${colors.success}15`
            : item.kind === 'deletion'
              ? `${colors.error}15`
              : item.kind === 'header'
                ? colors.surface
                : colors.background,
        minHeight: 22,
      }}
    >
      <Text
        style={{
          width: 68,
          color: colors.muted,
          fontFamily: 'monospace',
          fontSize: 11,
          lineHeight: 22,
          textAlign: 'right',
          paddingRight: 6,
        }}
      >
        {item.before ?? ''} {item.after ?? ''}
      </Text>
      <Text
        selectable
        style={{
          flex: 1,
          color:
            item.kind === 'addition'
              ? colors.success
              : item.kind === 'deletion'
                ? colors.error
                : colors.text,
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: 22,
        }}
      >
        {item.kind === 'addition' ? '+' : item.kind === 'deletion' ? '−' : ' '}
        {item.text || ' '}
      </Text>
    </View>
  )
  const list = (
    <FlatList
      key={wrap ? 'wrap' : 'scroll'}
      data={rows}
      keyExtractor={(_, index) => String(index)}
      renderItem={render}
      initialNumToRender={40}
      maxToRenderPerBatch={40}
      windowSize={7}
      style={{ flex: 1, width: wrap ? '100%' : contentWidth }}
    />
  )
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          paddingHorizontal: 12,
          minHeight: 44,
          backgroundColor: colors.surface,
        }}
      >
        <Text style={styles.muted}>Wrap lines</Text>
        <Switch accessibilityLabel="Wrap diff lines" value={wrap} onValueChange={setWrap} />
      </View>
      {wrap ? (
        list
      ) : (
        <ScrollView horizontal style={{ flex: 1 }}>
          {list}
        </ScrollView>
      )}
    </View>
  )
}
