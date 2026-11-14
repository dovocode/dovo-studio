import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useLocalSearchParams } from 'expo-router'
import { RuntimeRoute } from '../../shell/runtime-route'
import { backToCollection } from '../../shell/source-route'
import { WorkItemScreen } from './work-item'

export function WorkItemRoute({
  mode,
  jira = false,
}: {
  mode: 'issues' | 'pipelines'
  jira?: boolean
}) {
  const uiText = useInterfaceText()

  const { runtimeId, repositoryId, sourceId, itemId, url } = useLocalSearchParams<{
    runtimeId: string
    repositoryId?: string
    sourceId?: string
    itemId: string
    url?: string
  }>()
  const backTo = mode === 'issues' ? '/issues' : '/pulls'
  return (
    <RuntimeRoute
      runtimeId={runtimeId}
      repositoryId={jira ? undefined : repositoryId}
      jiraSourceId={jira ? sourceId : undefined}
      title={mode === 'issues' ? uiText('Issue') : uiText('Pipeline')}
      backTo={backTo}
    >
      <WorkItemScreen
        mode={mode}
        repositoryId={jira ? undefined : repositoryId}
        jiraSourceId={jira ? sourceId : undefined}
        itemId={itemId}
        expectedURL={url}
        onBack={() => backToCollection(backTo)}
      />
    </RuntimeRoute>
  )
}
