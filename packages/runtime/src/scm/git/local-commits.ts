import { decode, commitShaSchema, type LocalCommit } from '@dovo/protocol'
import type { GitService } from './git.js'
import { HttpError } from '../../errors.js'
import { ProcessError } from '../../process.js'

const PAGE_SIZE = 40

/** History and previews are pinned to immutable commits; none of these reads prepare a checkout. */
export class LocalCommits {
  constructor(private git: GitService) {}
  async list(cwd: string, head?: string) {
    if (head) await this.resolve(cwd, head)
    if (!head) {
      try {
        await this.git.command(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
      } catch (error) {
        if (error instanceof ProcessError && error.code === 1)
          return { commits: [], hasMore: false }
        throw error
      }
    }
    // NUL fields keep subjects and author names containing tabs unambiguous.
    const output = await this.git.readCommand(
      cwd,
      [
        'log',
        '--first-parent',
        `-${PAGE_SIZE + 1}`,
        '--format=%H%x00%P%x00%aI%x00%an%x00%s%x00',
        head ?? 'HEAD',
        '--',
      ],
      { timeout: 5_000, maxBuffer: 1024 * 1024 },
    )
    const fields = output.split('\0')
    const commits: LocalCommit[] = []
    for (let at = 0; at + 4 < fields.length; at += 5) {
      commits.push({
        sha: decode(commitShaSchema, fields[at].trim()),
        parents: fields[at + 1]
          .split(' ')
          .filter(Boolean)
          .map((sha) => decode(commitShaSchema, sha)),
        date: fields[at + 2],
        author: fields[at + 3],
        subject: fields[at + 4],
      })
    }
    return { commits: commits.slice(0, PAGE_SIZE), hasMore: commits.length > PAGE_SIZE }
  }
  async resolve(cwd: string, sha: string) {
    decode(commitShaSchema, sha)
    try {
      const type = (
        await this.git.readCommand(cwd, ['cat-file', '-t', sha], {
          timeout: 5_000,
          maxBuffer: 1024,
        })
      ).trim()
      if (type !== 'commit')
        throw new HttpError(404, 'Choose a commit from this checkout’s history.')
      await this.git.command(cwd, ['merge-base', '--is-ancestor', sha, 'HEAD'])
      // Revision walking conceals missing parents at shallow boundaries. Read the immutable
      // header so an incomplete checkout can never be presented as an all-added root commit.
      const raw = await this.git.readCommand(cwd, ['cat-file', '-p', sha], {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      })
      const parent = raw
        .slice(0, raw.indexOf('\n\n'))
        .split('\n')
        .find((line) => line.startsWith('parent '))
        ?.slice(7)
      if (parent) {
        try {
          await this.git.readCommand(
            cwd,
            ['rev-parse', '--verify', '--quiet', `${parent}^{tree}`],
            { timeout: 5_000, maxBuffer: 1024 },
          )
        } catch (error) {
          if (error instanceof ProcessError && (error.code === 1 || error.code === 128))
            throw new HttpError(
              409,
              'This commit’s parent is missing from the checkout. Fetch more history before reviewing it.',
            )
          throw error
        }
      }
      return { sha, parent }
    } catch (error) {
      if (error instanceof ProcessError && (error.code === 1 || error.code === 128))
        throw new HttpError(
          404,
          'Commit is unavailable in this checkout’s history. Refresh the commit list.',
        )
      throw error
    }
  }
  async changes(cwd: string, sha: string) {
    const commit = await this.resolve(cwd, sha)
    return {
      ...(await this.git.checkpointChanges(cwd, commit.parent, commit.sha)),
      sha: commit.sha,
      parent: commit.parent,
    }
  }
  async preview(cwd: string, sha: string, path: string, full = false, includePatch = false) {
    const commit = await this.resolve(cwd, sha)
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.includes('\0') ||
      path.split('/').some((part) => part === '..' || part === '.git')
    )
      throw new HttpError(400, 'Invalid file path')
    return this.git.checkpointFilePreview(cwd, commit.parent, commit.sha, path, full, includePatch)
  }
}
