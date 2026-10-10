import { markdownImages, type MarkdownImagePart } from './markdown-images'
import { ServerImage } from './server-image'
import { Text } from './text'
import { openAppLink } from './open-link'
import { nativeEffect } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { mermaidBlocks, type MarkdownPart } from './mermaid-blocks'
import { memo, lazy, Suspense, useMemo } from 'react'
import { Alert, Platform, View } from 'react-native'
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown'
import { resolveMarkdownLink } from '@dovo/protocol'
import { useTheme, type MobileTheme } from '../theme'
import { carZoom, useCarMode } from '../../runtime/preferences/app-preferences'
const MermaidDiagram = lazy(() =>
  import('./mermaid-diagram').then((module) => ({ default: module.MermaidDiagram })),
)
const monospace = Platform.OS === 'ios' ? 'Menlo' : 'monospace'
function createMarkdownStyles({ colors, styles }: MobileTheme) {
  const heading = {
    color: colors.text,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 8,
  }
  const markdownStyle: MarkdownStyle = {
    paragraph: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 26,
      marginTop: 0,
      marginBottom: 12,
    },
    h1: {
      ...heading,
      fontSize: 27,
      lineHeight: 34,
    },
    h2: {
      ...heading,
      fontSize: 23,
      lineHeight: 30,
    },
    h3: {
      ...heading,
      fontSize: 20,
      lineHeight: 27,
    },
    h4: {
      ...heading,
      fontSize: 18,
      lineHeight: 25,
    },
    h5: {
      ...heading,
      fontSize: 17,
      lineHeight: 24,
    },
    h6: {
      ...heading,
      fontSize: 16,
      lineHeight: 23,
      color: colors.muted,
    },
    list: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 26,
      marginTop: 0,
      marginBottom: 12,
      itemSpacing: 5,
      gapWidth: 8,
      markerMinWidth: 20,
      bulletColor: colors.muted,
      markerColor: colors.muted,
    },
    blockquote: {
      color: colors.muted,
      fontSize: 17,
      lineHeight: 26,
      backgroundColor: colors.surface,
      borderColor: colors.accent,
      borderWidth: 3,
      borderRadius: 6,
      padding: 12,
      marginTop: 4,
      marginBottom: 14,
      gapWidth: 10,
    },
    code: {
      color: colors.text,
      backgroundColor: colors.elevated,
      borderColor: colors.border,
    },
    codeBlock: {
      color: colors.text,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      fontFamily: monospace,
      fontSize: 13,
      lineHeight: 20,
      padding: 14,
      borderRadius: 12,
      marginTop: 4,
      marginBottom: 14,
      syntaxColors: {
        keyword: colors.syntaxKeyword,
        string: colors.success,
        number: colors.warning,
        constant: colors.warning,
        comment: colors.muted,
        function: colors.syntaxFunction,
        type: colors.warning,
        property: colors.text,
        tag: colors.syntaxKeyword,
        attribute: colors.warning,
      },
    },
    link: {
      color: colors.accent,
      underline: true,
    },
    strong: {
      color: colors.text,
    },
    image: {
      maxHeight: 360,
      resizeMode: 'contain',
      borderRadius: 10,
      marginTop: 8,
      marginBottom: 14,
    },
    thematicBreak: {
      color: colors.border,
      height: 1,
      marginTop: 16,
      marginBottom: 16,
    },
    table: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 4,
      marginBottom: 14,
      headerTextColor: colors.text,
      headerBackgroundColor: colors.elevated,
      rowEvenBackgroundColor: colors.background,
      rowOddBackgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 10,
      cellPaddingHorizontal: 12,
      cellPaddingVertical: 10,
      horizontalOverflow: 0,
    },
    taskList: {
      checkedColor: colors.accent,
      borderColor: colors.muted,
      checkedTextColor: colors.muted,
      checkboxSize: 18,
      checkboxBorderRadius: 4,
      checkedStrikethrough: false,
    },
  }
  // Conversation reading: generous body text, quiet inline code and roomy lists.
  const chatMarkdownStyle: MarkdownStyle = {
    ...markdownStyle,
    paragraph: {
      ...markdownStyle.paragraph,
      ...styles.chatText,
      marginBottom: 14,
    },
    h1: { ...heading, fontSize: 24, lineHeight: 30, marginTop: 18 },
    h2: { ...heading, fontSize: 21, lineHeight: 27, marginTop: 18 },
    h3: { ...heading, fontSize: 19, lineHeight: 25, marginTop: 16 },
    h4: { ...heading, fontSize: 17, lineHeight: 25, marginTop: 16 },
    h5: { ...heading, fontSize: 17, lineHeight: 25, marginTop: 14 },
    h6: { ...heading, fontSize: 15, lineHeight: 22, marginTop: 14, color: colors.muted },
    list: {
      ...markdownStyle.list,
      ...styles.chatText,
      marginBottom: 14,
      itemSpacing: 6,
      // Bullets sit at the text margin, with a wide gap before the item text.
      marginLeft: 0,
      gapWidth: 18,
      markerMinWidth: 8,
      bulletSize: 5,
    },
    blockquote: {
      ...markdownStyle.blockquote,
      ...styles.chatText,
      color: colors.muted,
      padding: 12,
      marginBottom: 14,
    },
    // Inline code reads as a quiet monospace span, not a chip competing with the prose.
    code: {
      fontFamily: monospace,
      fontSize: 16,
      color: colors.muted,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
  }
  return {
    markdownStyle,
    chatMarkdownStyle,
    carMarkdownStyle: zoomMarkdown(markdownStyle),
    carChatMarkdownStyle: zoomMarkdown(chatMarkdownStyle),
  }
}
/** Car mode: the same styles with every font size and line height enlarged. */
function zoomMarkdown(style: MarkdownStyle): MarkdownStyle {
  return Object.fromEntries(
    Object.entries(style).map(([element, value]) => {
      if (!value || typeof value !== 'object') return [element, value]
      const scaled: Record<string, unknown> = { ...value }
      for (const field of ['fontSize', 'lineHeight', 'checkboxSize', 'bulletSize'])
        if (typeof scaled[field] === 'number') scaled[field] = (scaled[field] as number) * carZoom
      return [element, scaled]
    }),
  ) as MarkdownStyle
}
export const Markdown = memo(function Markdown({
  text,
  baseURL,
  fileBaseURL,
  preserveLineBreaks = false,
  variant = 'default',
  onLinkLongPress,
  taskId,
}: {
  text: string
  taskId?: string
  baseURL?: string
  fileBaseURL?: string
  preserveLineBreaks?: boolean
  variant?: 'default' | 'chat'
  onLinkLongPress?: (url: string) => void
}) {
  const theme = useTheme()
  const { styles } = theme
  const { markdownStyle, chatMarkdownStyle, carMarkdownStyle, carChatMarkdownStyle } = useMemo(
    () => createMarkdownStyles(theme),
    [theme],
  )
  const parts = useMemo(
    () =>
      mermaidBlocks(text).flatMap<MarkdownPart | Extract<MarkdownImagePart, { kind: 'image' }>>(
        (part) =>
          part.kind === 'mermaid'
            ? [part]
            : markdownImages(part.text).map((image) =>
                image.kind === 'text'
                  ? {
                      kind: 'markdown' as const,
                      text: image.text,
                      offset: part.offset + image.offset,
                    }
                  : { ...image, offset: part.offset + image.offset },
              ),
      ),
    [text],
  )
  const car = useCarMode()
  const style =
    variant === 'chat'
      ? car
        ? carChatMarkdownStyle
        : chatMarkdownStyle
      : car
        ? carMarkdownStyle
        : markdownStyle
  return (
    <View style={{ width: '100%', gap: 8 }}>
      {parts.map((part) =>
        part.kind === 'mermaid' ? (
          <Suspense
            key={part.offset}
            fallback={<Text style={styles.muted}>Rendering diagram…</Text>}
          >
            <MermaidDiagram chart={part.text} />
          </Suspense>
        ) : part.kind === 'image' ? (
          (() => {
            let uri: string | undefined
            try {
              const url = new URL(part.url, fileBaseURL ?? baseURL)
              if (
                ['http:', 'https:'].includes(url.protocol) ||
                /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(part.url)
              )
                uri = url.toString()
            } catch {
              /* A server-local path is resolved through its thread. */
            }
            return uri ? (
              <ServerImage key={part.offset} source={{ uri }} label={part.alt} />
            ) : taskId ? (
              <ServerImage key={part.offset} source={{ taskId, path: part.url }} label={part.alt} />
            ) : (
              <Text key={part.offset} style={styles.muted}>
                Image unavailable: {part.alt}
              </Text>
            )
          })()
        ) : (
          <EnrichedMarkdownText
            key={part.offset}
            markdown={part.text}
            flavor="github"
            markdownStyle={style}
            selectable
            allowFontScaling
            lineBreakStrategyIOS="standard"
            enableTaskListItemToggle={false}
            md4cFlags={{
              latexMath: false,
              hardSoftBreaks: preserveLineBreaks,
            }}
            containerStyle={{
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
              flexShrink: 1,
            }}
            onLinkPress={({ url }) => {
              const target = resolveMarkdownLink(url, baseURL, fileBaseURL)
              if (target) {
                void runClientEffect(
                  nativeEffect(() => openAppLink(target)).pipe(
                    Effect.catch((error) =>
                      nativeEffect(() => Alert.alert('Could not open link', String(error))),
                    ),
                  ),
                )
              } else {
                Alert.alert('Desktop link', 'Open this file or link on your desktop.')
              }
            }}
            onLinkLongPress={
              onLinkLongPress
                ? ({ url }) => {
                    const target = resolveMarkdownLink(url, baseURL, fileBaseURL)
                    if (target) onLinkLongPress(target)
                  }
                : undefined
            }
          />
        ),
      )}
    </View>
  )
})
