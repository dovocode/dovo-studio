import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exec } from '../process.js'
import type { Workspace } from '@dovo/protocol'
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-runtime-test-'))
  await exec('git', ['init', '-q'], { cwd: directory })
  await exec('git', ['config', 'user.name', 'Dovo Test'], { cwd: directory })
  await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: directory })
  await writeFile(join(directory, 'hello.txt'), 'original\n')
  await exec('git', ['add', 'hello.txt'], { cwd: directory })
  await exec('git', ['commit', '-qm', 'Initial fixture'], { cwd: directory })
  const workspace: Workspace = {
    version: 1,
    runtimeAddress: '',
    agents: [
      {
        id: 'agent',
        name: 'Test',
        provider: 'codex',
        model: '',
        instructions: '',
        permission: 'ask',
        endpoint: '',
      },
    ],
    repositories: [{ id: 'repo', name: 'Test', path: directory, branch: 'main' }],
    tasks: [],
    automations: [],
  }
  return { directory, workspace, cleanup: () => rm(directory, { recursive: true, force: true }) }
}
