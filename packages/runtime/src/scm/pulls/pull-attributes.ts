import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PullDetail } from '@dovo/protocol'
import type { GitService } from '../git/git.js'
import { processEnvironment } from '../../process.js'
import { errorMessage } from '../../errors.js'

/** Let Git resolve nested patterns, macros and overrides from the exact PR revision. */
export async function pullAttributes(git: GitService, cwd: string, detail: PullDetail) {
  if (!detail.files.length) return detail
  let directory: string | undefined
  try {
    const head = detail.pull.headSha
    if (!/^[a-f0-9]{40,64}$/i.test(head)) throw new Error('Invalid PR revision')
    const available = await git.command(cwd, ['cat-file', '-e', `${head}^{commit}`]).then(
      () => true,
      () => false,
    )
    if (!available)
      await git.fetchPull(
        cwd,
        detail.pull.repositoryUrl,
        detail.pull.number,
        `refs/dovo/pull-attributes/${detail.pull.number}`,
        detail.pull,
      )
    // A private Git directory excludes the user's info/attributes, global rules and dirty files.
    const objects = (
      await git.command(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'objects'])
    ).trim()
    directory = await mkdtemp(join(tmpdir(), 'dovo-pull-attributes-'))
    await git.command(cwd, ['init', '--bare', '--template=', directory])
    const env = { ...processEnvironment(), GIT_OBJECT_DIRECTORY: objects, GIT_ATTR_NOSYSTEM: '1' }
    const attributes = new Map<string, Map<string, string>>()
    for (let index = 0; index < detail.files.length; index += 100) {
      const output = await git.command(
        cwd,
        [
          `--git-dir=${directory}`,
          '-c',
          'core.attributesFile=',
          'check-attr',
          `--source=${head}`,
          '-z',
          'diff',
          'linguist-generated',
          'linguist-vendored',
          '--',
          ...detail.files.slice(index, index + 100).map((file) => file.path),
        ],
        env,
      )
      const fields = output.split('\0')
      for (let offset = 0; offset + 2 < fields.length; offset += 3) {
        const [path, attribute, value] = fields.slice(offset, offset + 3)
        const values = attributes.get(path) ?? new Map<string, string>()
        values.set(attribute, value)
        attributes.set(path, values)
      }
    }
    const enabled = (value: string | undefined) => value === 'set' || value === 'true'
    return {
      ...detail,
      files: detail.files.map((file) => {
        const values = attributes.get(file.path)
        return {
          ...file,
          attributes: {
            binary: values?.get('diff') === 'unset',
            generated: enabled(values?.get('linguist-generated')),
            vendored: enabled(values?.get('linguist-vendored')),
          },
        }
      }),
    }
  } catch (error) {
    return {
      ...detail,
      warnings: [
        ...detail.warnings,
        `File attributes: Could not read PR .gitattributes. ${errorMessage(error)}`,
      ],
    }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}
