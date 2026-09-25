import { nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { memo } from 'react'
import { Alert, Linking, Platform } from 'react-native'
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown'
import { resolveMarkdownLink } from '@dovo/protocol'
import { colors, styles } from './theme'
const monospace = Platform.OS === 'ios' ? 'Menlo' : 'monospace'
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
    backgroundColor: '#141416',
    borderColor: colors.accent,
    borderWidth: 3,
    borderRadius: 6,
    padding: 12,
    marginTop: 4,
    marginBottom: 14,
    gapWidth: 10,
  },
  code: {
    color: '#e5e5ea',
    backgroundColor: '#202024',
    borderColor: '#202024',
  },
  codeBlock: {
    color: colors.text,
    backgroundColor: '#141416',
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
      keyword: '#d6a3ed',
      string: '#a4d6b2',
      number: '#eac28e',
      constant: '#eac28e',
      comment: '#92949e',
      function: '#8bbdf7',
      type: '#ebd79c',
      property: '#c6d9ec',
      tag: '#d6a3ed',
      attribute: '#ebd79c',
    },
  },
  link: {
    color: colors.accent,
    underline: true,
  },
  strong: {
    color: '#ffffff',
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
    headerBackgroundColor: '#252529',
    rowEvenBackgroundColor: colors.background,
    rowOddBackgroundColor: '#141416',
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
export const Markdown = memo(function Markdown({
  text,
  baseURL,
  fileBaseURL,
  preserveLineBreaks = false,
  variant = 'default',
}: {
  text: string
  baseURL?: string
  fileBaseURL?: string
  preserveLineBreaks?: boolean
  variant?: 'default' | 'chat'
}) {
  return (
    <EnrichedMarkdownText
      markdown={text}
      flavor="github"
      markdownStyle={variant === 'chat' ? chatMarkdownStyle : markdownStyle}
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
            nativeEffect(() => Linking.openURL(target)).pipe(
              Effect.catchAll((error) =>
                nativeEffect(() => Alert.alert('Could not open link', String(error))),
              ),
            ),
          )
        } else {
          Alert.alert('Desktop link', 'Open this file or link on your desktop.')
        }
      }}
    />
  )
})
