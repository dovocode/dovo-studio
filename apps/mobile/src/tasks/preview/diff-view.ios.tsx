import { useTheme } from '../../ui/theme'
import { DiffsView } from 'react-native-diffs'
export function DiffView({ patch }: { patch: string }) {
  const { colors, mode: appearanceMode } = useTheme()

  // Keep embedded backticks inside the native diff block.
  const fence = '`'.repeat(
    (patch.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length + 1), 3),
  )
  return (
    <DiffsView
      content={`${fence}diff\n${patch}\n${fence}`}
      colorScheme={appearanceMode}
      showsBlockHeaders={false}
      style={{ flex: 1, backgroundColor: colors.surface }}
      theme={{
        fonts: { codeSize: 12 },
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
