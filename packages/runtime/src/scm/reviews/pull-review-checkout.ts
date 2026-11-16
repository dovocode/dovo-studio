import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Services } from '../../services.js'
import { errorMessage } from '../../errors.js'

export async function pullReviewSource(
  repository: string | undefined,
  headSha: string,
  git: Services['git'],
  signal: AbortSignal,
): Promise<{ checkout?: Awaited<ReturnType<typeof pullReviewCheckout>>; notVerified: string[] }> {
  if (!repository)
    return {
      notVerified: [
        'No local project contains the captured PR revision. Tools can use only supplied evidence.',
      ],
    }
  try {
    return { checkout: await pullReviewCheckout(repository, headSha, git, signal), notVerified: [] }
  } catch (error) {
    signal.throwIfAborted()
    return {
      notVerified: [
        `Captured repository source was unavailable. Tools can use only supplied evidence: ${errorMessage(error)}`,
      ],
    }
  }
}

/** Capture the PR revision without switching or changing the user's working files. */
async function pullReviewCheckout(
  repository: string,
  headSha: string,
  git: Services['git'],
  signal: AbortSignal,
) {
  if (!/^[a-f0-9]{40,64}$/i.test(headSha)) throw new Error('Invalid captured PR commit.')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-pr-source-'))
  const path = join(directory, 'source')
  const dispose = () => rm(directory, { recursive: true, force: true })
  try {
    await git.readCommand(repository, ['cat-file', '-e', `${headSha}^{commit}`], { signal })
    await git.readCommand(
      repository,
      [
        '-c',
        'core.hooksPath=',
        'clone',
        '--shared',
        '--no-checkout',
        '--no-hardlinks',
        '--',
        repository,
        path,
      ],
      { signal, timeout: 60_000 },
    )
    await git.readCommand(
      path,
      [
        '-c',
        'core.hooksPath=',
        '-c',
        'filter.lfs.smudge=',
        '-c',
        'filter.lfs.process=',
        '-c',
        'filter.lfs.required=false',
        'checkout',
        '--detach',
        headSha,
      ],
      { signal, timeout: 60_000 },
    )
    if ((await git.readCommand(path, ['rev-parse', 'HEAD'], { signal })).trim() !== headSha)
      throw new Error('The review checkout does not match the captured PR commit.')
    return { path, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
