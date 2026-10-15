import { useEffect, useCallback, useMemo, useState, useRef } from 'react'
import {
  FlatList,
  ScrollView,
  Switch,
  View,
  Pressable,
  Platform,
  useWindowDimensions,
} from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import type { ReviewDiffProps } from './diff-lines'
import { diffLanguages, highlightedDiffRows, type HighlightedDiffRow } from './diff-syntax'
import { diffContentWidth } from './diff-layout'
import { diffRows } from './diff-lines'
import { useSyntax } from '../../ui/content/use-syntax'
import { SyntaxText } from '../../ui/content/syntax-text'
import type { SyntaxTokenize } from '../../ui/content/syntax-highlighter'
import { carZoom, useCarMode } from '../../runtime/preferences/app-preferences'

const monospace = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

export function DiffView({
  patch,
  path,
  previousPath,
  before,
  after,
  focusedLine,
  onLinePress,
  annotations = [],
}: ReviewDiffProps) {
  const { colors, styles, code, syntaxTheme } = useTheme()
  const codeColors = code
    ? {
        ...colors,
        background: code.colors.background,
        surface: code.colors.background,
        text: code.colors.text,
        muted: code.colors.gutter,
      }
    : colors
  const addition = code?.colors.addition ?? colors.success
  const deletion = code?.colors.deletion ?? colors.error
  const changeAlpha = syntaxTheme.type === 'dark' ? '33' : '15'
  const { width, fontScale } = useWindowDimensions()
  const car = useCarMode()
  const textScale = fontScale * (car ? carZoom : 1)
  const [wrap, setWrap] = useState(false)
  const plainRows = useMemo(() => diffRows(patch), [patch])
  const languages = useMemo(
    () => diffLanguages(patch, path, previousPath),
    [patch, path, previousPath],
  )
  const highlight = useCallback(
    (tokenize: SyntaxTokenize) =>
      highlightedDiffRows(patch, path, previousPath, tokenize, { before, after }),
    [patch, path, previousPath, before, after],
  )
  const syntax = useSyntax(languages, highlight)
  const rows = syntax?.value ?? plainRows
  const contentWidth = useMemo(
    () =>
      diffContentWidth(
        rows.map((row) => row.text),
        width,
        textScale,
      ),
    [rows, width, textScale],
  )
  const listRef = useRef<FlatList<HighlightedDiffRow>>(null)
  useEffect(() => {
    const index = plainRows.findIndex((row) => row.after === focusedLine)
    if (focusedLine === undefined || index < 0) return
    const frame = requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: false }),
    )
    return () => cancelAnimationFrame(frame)
  }, [plainRows, focusedLine])
  const render = ({ item }: { item: HighlightedDiffRow }) => (
    <View>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor:
            focusedLine !== undefined && item.after === focusedLine
              ? (code?.colors.selection ?? colors.selection)
              : item.kind === 'addition'
                ? `${addition}${changeAlpha}`
                : item.kind === 'deletion'
                  ? `${deletion}${changeAlpha}`
                  : item.kind === 'header'
                    ? codeColors.surface
                    : codeColors.background,
          minHeight: 20,
        }}
      >
        <Pressable
          // Keep the gutter on the first visual line when source wraps.
          style={{ justifyContent: 'flex-start' }}
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
              width: 68 * textScale,

              color: codeColors.muted,
              fontFamily: monospace,
              fontSize: 11,
              lineHeight: 20,
              includeFontPadding: false,
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
            fontFamily: monospace,
            fontSize: 13,
            lineHeight: 20,
            includeFontPadding: false,
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
          {item.spans?.length ? <SyntaxText tokens={item.spans} /> : item.text || ' '}
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
      {syntax?.error && (
        <Text accessibilityRole="alert" style={[styles.muted, { color: codeColors.muted }]}>
          {syntax.error}
        </Text>
      )}
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
