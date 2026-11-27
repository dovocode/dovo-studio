import { useState } from 'react'
import { pullFilePatch, type PullRevisionComparison } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import { Text } from '../../../ui/content/text'
import { Action } from '../../../ui/controls/action'
import { Choice } from '../../../ui/controls/choice'
import { DiffView } from '../../../tasks/preview/diff-view'

export function PullRevisionComparisonView({
  comparison,
  onOpen,
}: {
  comparison: PullRevisionComparison
  onOpen: (url: string) => void
}) {
  const uiText = useInterfaceText()
  const [path, setPath] = useState('')
  const file = comparison.files.find((item) => item.path === path) ?? comparison.files[0]
  return (
    <View style={{ gap: 8 }}>
      <Text>{uiText('Changed files: {value0}', { value0: comparison.files.length })}</Text>
      <Action
        secondary
        label={uiText('Open comparison on GitHub')}
        onPress={() => onOpen(comparison.url)}
      />
      {comparison.limited && <Text>{uiText('GitHub returned the first 300 files.')}</Text>}
      {!file ? (
        <Text>{uiText('No files changed between these revisions.')}</Text>
      ) : (
        <>
          <Choice
            label={uiText('Files')}
            value={file.path}
            items={comparison.files.map((item) => ({ id: item.path, name: item.path }))}
            onChange={setPath}
          />
          {file.patch ? (
            <View style={{ height: 360 }}>
              <DiffView
                key={file.path}
                patch={pullFilePatch(file)}
                path={file.path}
                previousPath={file.previousPath}
              />
            </View>
          ) : (
            <Text>{uiText('No text patch available for this file.')}</Text>
          )}
        </>
      )}
    </View>
  )
}
