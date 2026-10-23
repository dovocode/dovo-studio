import { checkpointFiles, filePreviewLabel, pullFileKind, type FileKind } from '@dovo/protocol'
import { useMemo } from 'react'
import { View } from 'react-native'
import type { ChangedFile } from '@dovo/protocol'
import { fileStats } from '../../files/stats'
import { MobileFileTree } from '../../../ui/content/file-tree'

export function CheckpointFiles({
  files,
  omitted,
  onOpen,
  kind,
}: {
  files: ChangedFile[]
  omitted: string[]
  onOpen: (path: string) => void
  kind?: FileKind
}) {
  const entries = useMemo(
    () =>
      checkpointFiles({ files, omitted })
        .filter((file) => !kind || pullFileKind(file) === kind)
        .map((file) => ({
          changeKind: pullFileKind(file),
          path: file.path,
          ...(file.preview ? { label: filePreviewLabel(file) } : fileStats(file)),
        })),
    [files, omitted, kind],
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
