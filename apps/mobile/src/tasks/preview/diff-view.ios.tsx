import { DiffView as InteractiveDiffView } from './interactive-diff-view'
import type { ReviewDiffProps } from './diff-lines'
import { useTheme } from '../../ui/theme'
import { DiffsView } from 'react-native-diffs'
import { diffLanguage } from './diff-syntax'
export function DiffView(props: ReviewDiffProps) {
  const { colors, mode: appearanceMode, code } = useTheme()
  const language = diffLanguage(props.path)
  const previousLanguage = diffLanguage(props.previousPath ?? props.path)

  if (
    // Native DiffsView cannot accept token palettes; use the themed renderer when configured.
    code ||
    props.onLinePress ||
    props.focusedLine !== undefined ||
    props.annotations?.length ||
    language !== previousLanguage ||
    language === 'markdown'
  )
    return <InteractiveDiffView {...props} />
  const { patch } = props
  // Keep embedded backticks inside the native diff block.
  const fence = '`'.repeat(
    (patch.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length + 1), 3),
  )
  return (
    <DiffsView
      content={`${fence}diff${language ? ` ${language === 'markup' ? 'html' : language}` : ''}\n${patch}\n${fence}`}
      colorScheme={appearanceMode}
      showsBlockHeaders={false}
      style={{ flex: 1, backgroundColor: colors.surface }}
      theme={{
        fonts: { codeSize: 13 },
        diff: {
          displayMode: 'unified',
          backgroundColor: colors.surface,
          gutterBackground: colors.background,
          borderWidth: 0,
        },
      }}
    />
  )
}
