import { repositoryLocationSchema, type RepositoryOpenTarget } from '@dovo/protocol'
import { useWorkspace, useStudioHost } from '@dovo/studio-core'

export function useRepositoryOpen() {
  const { request } = useWorkspace()
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
