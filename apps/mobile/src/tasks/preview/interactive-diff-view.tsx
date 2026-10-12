import { useEffect, useMemo, useState, useRef } from 'react'
import { FlatList, ScrollView, Switch, View, Pressable, useWindowDimensions } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { diffRows, type DiffRow, type ReviewDiffProps } from './diff-lines'
// Android: upstream react-native-diffs only implements the iOS renderer.
export function DiffView({ patch, focusedLine, onLinePress, annotations = [] }: ReviewDiffProps) {
  const { colors, styles } = useTheme()
  const { width } = useWindowDimensions()
  const [wrap, setWrap] = useState(false)
  const rows = useMemo(() => diffRows(patch), [patch])
  const contentWidth = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.text.length * 8 + 92), width),
    [rows, width],
  )
  const listRef = useRef<FlatList<DiffRow>>(null)
  useEffect(() => {
    const index = rows.findIndex((row) => row.after === focusedLine)
    if (focusedLine === undefined || index < 0) return
    const frame = requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: false }),
    )
    return () => cancelAnimationFrame(frame)
  }, [rows, focusedLine])
  const render = ({ item }: { item: DiffRow }) => (
    <View>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor:
            focusedLine !== undefined && item.after === focusedLine
              ? colors.selection
              : item.kind === 'addition'
                ? `${colors.success}15`
                : item.kind === 'deletion'
                  ? `${colors.error}15`
                  : item.kind === 'header'
                    ? colors.surface
                    : colors.background,
          minHeight: onLinePress ? 44 : 22,
        }}
      >
        <Pressable
          style={{ minHeight: onLinePress ? 44 : 22, justifyContent: 'center' }}
          disabled={!onLinePress || (item.after === undefined && item.before === undefined)}
          accessibilityRole="button"
          accessibilityLabel={`Comment on ${item.kind === 'deletion' ? 'old' : 'new'} line ${item.kind === 'deletion' ? item.before : item.after}`}
          onPress={() => {
            const line = item.kind === 'deletion' ? item.before : item.after
            if (line !== undefined)
              onLinePress?.(line, item.kind === 'deletion' ? 'deletions' : 'additions')
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
        </Pressable>
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
      {annotations
        .filter((annotation) =>
          annotation.side === 'deletions'
            ? annotation.line === item.before && item.kind === 'deletion'
            : annotation.line === item.after && item.kind !== 'deletion',
        )
        .map((annotation, index) => (
          <View key={index} style={{ padding: 12, backgroundColor: colors.surface }}>
            <Text style={styles.muted}>Review comment</Text>
            <Text style={styles.text}>{annotation.text}</Text>
          </View>
        ))}
    </View>
  )
  const list = (
    <FlatList
      ref={listRef}
      onScrollToIndexFailed={(info) =>
        listRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: false,
        })
      }
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
