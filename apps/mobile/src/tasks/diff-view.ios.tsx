import { DiffsView } from 'react-native-diffs'
export function DiffView({ patch }: { patch: string }) {
  // Keep embedded backticks inside the native diff block.
  const fence = '`'.repeat(
    (patch.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length + 1), 3),
  )
  return (
    <DiffsView
      content={`${fence}diff\n${patch}\n${fence}`}
      colorScheme="dark"
      showsBlockHeaders={false}
      style={{ flex: 1, backgroundColor: '#101113' }}
      theme={{
        fonts: { codeSize: 12 },
        diff: {
          displayMode: 'unified',
          backgroundColor: '#101113',
          gutterBackground: '#191a1d',
          borderWidth: 0,
        },
      }}
    />
  )
}
