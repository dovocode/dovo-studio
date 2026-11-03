import { homedir } from 'node:os'
import { realpath } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, responses, STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const ownerToken = 'workspace-terminal-owner-token-at-least-32-chars'
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanups.push(runtime.close)
  runtime.services.store.update(() => ({ ...f.workspace, tasks: [] }))
  const token = 'paired-computer-terminal-token-at-least-32-chars'
  runtime.services.devices.add('Paired computer', token)
  const post = (input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/terminals/workspace`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  return { ...f, runtime, post }
}
it('opens home and project shells for a paired device without creating threads', async () => {
  const { runtime, post, directory, workspace } = await setup()
  const home = decode(responses.terminal, await (await post({})).json())
  expect(home.taskId).toBe(STUDIO_TERMINAL_SCOPE)
  expect(runtime.services.terminals.get(home.id).directory).toBe(await realpath(homedir()))
  const project = decode(
    responses.terminal,
    await (await post({ repositoryId: workspace.repositories[0].id })).json(),
  )
  expect(project.repositoryId).toBe(workspace.repositories[0].id)
  expect(runtime.services.terminals.get(project.id).directory).toBe(await realpath(directory))
  expect(runtime.services.store.get().tasks).toEqual([])
})
it('rejects unknown projects and unpaired devices before opening shells', async () => {
  const { runtime, post } = await setup()
  expect((await post({ repositoryId: 'missing' })).status).toBe(404)
  expect((await post({}, 'unpaired-token-at-least-32-characters')).status).toBe(401)
  expect((await post({ command: '' })).status).toBe(400)
  expect(runtime.services.terminals.list()).toEqual([])
})
it('runs explicitly submitted input in the new standalone terminal', async () => {
  const { runtime, post } = await setup()
  const session = decode(
    responses.terminal,
    await (
      await post({
        command: `"${process.execPath}" -e "process.stdout.write('workspace-' + 'command-ready')"`,
      })
    ).json(),
  )
  await waitForRuntime(() =>
    expect(runtime.services.terminals.get(session.id).buffer).toContain('workspace-command-ready'),
  )
})
