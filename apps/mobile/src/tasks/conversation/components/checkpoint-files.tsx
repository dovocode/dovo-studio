import { checkpointFiles, filePreviewLabel } from '@dovo/protocol'
import { useMemo } from 'react'
import { View } from 'react-native'
import type { ChangedFile } from '@dovo/protocol'
import { fileStats } from '../../files/stats'
import { MobileFileTree } from '../../../ui/content/file-tree'

export function CheckpointFiles({
  files,
  omitted,
  onOpen,
}: {
  files: ChangedFile[]
  omitted: string[]
  onOpen: (path: string) => void
}) {
  const entries = useMemo(
    () =>
      checkpointFiles({ files, omitted }).map((file) => ({
        path: file.path,
        ...(file.preview ? { label: filePreviewLabel(file) } : fileStats(file)),
      })),
    [files, omitted],
  )
  return (
    <View>
      <MobileFileTree
        files={entries}
        onSelect={onOpen}
        scrollable={false}
        defaultExpandedDepth={0}
      />
    </View>
  )
}
