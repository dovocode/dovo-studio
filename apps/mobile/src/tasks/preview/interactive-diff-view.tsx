import { useEffect, useMemo, useState, useRef } from 'react'
import { FlatList, ScrollView, Switch, View, Pressable, useWindowDimensions } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme, type MobileColors } from '../../ui/theme'
import type { ReviewDiffProps } from './diff-lines'
import { highlightedDiffRows, type HighlightedDiffRow } from './diff-syntax'

function syntaxColor(kind: string | undefined, colors: MobileColors) {
  switch (kind) {
    case 'comment':
    case 'prolog':
    case 'doctype':
      return colors.muted
    case 'keyword':
    case 'tag':
    case 'boolean':
      return colors.syntaxKeyword
    case 'function':
      return colors.syntaxFunction
    case 'string':
    case 'char':
    case 'attr-value':
    case 'template-string':
      return colors.success
    case 'number':
    case 'constant':
    case 'class-name':
    case 'builtin':
    case 'attr-name':
      return colors.warning
    default:
      return colors.text
  }
}
// Android: upstream react-native-diffs only implements the iOS renderer.
export function DiffView({
  patch,
  path,
  previousPath,
  focusedLine,
  onLinePress,
  annotations = [],
}: ReviewDiffProps) {
  const { colors, styles, code } = useTheme()
  const codeColors = code
    ? {
        ...colors,
        background: code.colors.background,
        surface: code.colors.background,
        text: code.colors.text,
        muted: code.colors.gutter,
        syntaxKeyword: code.colors.keyword,
        syntaxFunction: code.colors.function,
        success: code.colors.string,
        warning: code.colors.number,
      }
    : colors
  const addition = code?.colors.addition ?? colors.success
  const deletion = code?.colors.deletion ?? colors.error
  const { width } = useWindowDimensions()
  const [wrap, setWrap] = useState(false)
  const rows = useMemo(
    () => highlightedDiffRows(patch, path, previousPath),
    [patch, path, previousPath],
  )
  const contentWidth = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.text.length * 8 + 92), width),
    [rows, width],
  )
  const listRef = useRef<FlatList<HighlightedDiffRow>>(null)
  useEffect(() => {
    const index = rows.findIndex((row) => row.after === focusedLine)
    if (focusedLine === undefined || index < 0) return
    const frame = requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: false }),
    )
    return () => cancelAnimationFrame(frame)
  }, [rows, focusedLine])
  const render = ({ item }: { item: HighlightedDiffRow }) => (
    <View>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor:
            focusedLine !== undefined && item.after === focusedLine
              ? (code?.colors.selection ?? colors.selection)
              : item.kind === 'addition'
                ? `${addition}15`
                : item.kind === 'deletion'
                  ? `${deletion}15`
                  : item.kind === 'header'
                    ? codeColors.surface
                    : codeColors.background,
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
            color: item.kind === 'header' ? codeColors.muted : codeColors.text,
            fontFamily: 'monospace',
            fontSize: 13,
            lineHeight: 22,
          }}
        >
          <Text
            style={{
              color:
                item.kind === 'addition'
                  ? addition
                  : item.kind === 'deletion'
                    ? deletion
                    : colors.muted,
            }}
          >
            {item.kind === 'addition' ? '+' : item.kind === 'deletion' ? '−' : ' '}
          </Text>
          {item.spans?.length
            ? item.spans.map((span, index) => (
                <Text
                  key={index}
                  style={{
                    color:
                      span.kind === 'comment' && code
                        ? code.colors.comment
                        : (span.kind === 'class-name' || span.kind === 'builtin') && code
                          ? code.colors.type
                          : syntaxColor(span.kind, codeColors),
                  }}
                >
                  {span.text}
                </Text>
              ))
            : item.text || ' '}
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
    <View style={{ flex: 1, minHeight: 0, backgroundColor: codeColors.background }}>
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
