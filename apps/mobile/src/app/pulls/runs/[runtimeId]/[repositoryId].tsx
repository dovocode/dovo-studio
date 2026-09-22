import { useLocalSearchParams } from 'expo-router'
import { WorkbenchDetailRoute } from '../../../../shell/workbench'
import { RuntimeRoute } from '../../../../shell/runtime-route'
import { backToCollection } from '../../../../shell/source-route'
import { projectSourceKey } from '../../../../runtime/collection-sources'
import { WorkScreen } from '../../../../scm/work'

export default function PipelineRunsRoute() {
  const { runtimeId, repositoryId, sha, pull } = useLocalSearchParams<{
    runtimeId: string
    repositoryId: string
    sha: string
    pull: string
  }>()
  return (
    <WorkbenchDetailRoute tab="pulls" bottomInset>
      <RuntimeRoute
        runtimeId={runtimeId}
        repositoryId={repositoryId}
        title="PR runs"
        backTo="/pulls"
      >
        <WorkScreen
          mode="pipelines"
          repositoryId={projectSourceKey(runtimeId, repositoryId)}
          commitSha={sha ?? ''}
          pullNumber={pull}
          onBack={() => backToCollection('/pulls')}
        />
      </RuntimeRoute>
    </WorkbenchDetailRoute>
  )
}
