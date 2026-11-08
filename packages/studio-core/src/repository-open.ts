import { repositoryLocationSchema, type RepositoryOpenTarget } from '@dovo/protocol'
import { useWorkspaceSelector, useStudioHost, type useWorkspace } from '@dovo/studio-core'

const selectRequest = (value: ReturnType<typeof useWorkspace>) => value.request

export function useRepositoryOpen() {
  const request = useWorkspaceSelector(selectRequest)
  const { repositoryOpener } = useStudioHost()
  return async (
    input: { repositoryId?: string; taskId?: string; path?: string },
    target: RepositoryOpenTarget,
  ) => {
    if (!repositoryOpener)
      throw new Error(
        'Open this workspace in the Dovo Studio desktop app to use editors on your computer.',
      )
    const location = await request(
      input.path === undefined ? '/api/scm/open-location' : '/api/tasks/files/location',
      input,
      repositoryLocationSchema,
    )
    await repositoryOpener.open({ ...location, target })
  }
}
