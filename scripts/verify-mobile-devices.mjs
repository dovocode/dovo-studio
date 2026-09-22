import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import fixture from './fixtures/device-runtime.cjs'

const device = process.argv[2]
if (!device) throw new Error('Pass an iOS simulator UUID with the native app installed')
const directory = await mkdtemp(join(tmpdir(), 'dovo-mobile-devices-'))
let first, second
try {
  first = await fixture.startDeviceRuntime({
    directory: join(directory, 'first'),
    repository: 'first',
    title: 'First host task',
  })
  second = await fixture.startDeviceRuntime({
    directory: join(directory, 'second'),
    repository: 'second',
    title: 'Second host task',
  })
  const runFlow = async (flow, environment) => {
    const child = spawn(
      'maestro',
      [
        '--device',
        device,
        'test',
        ...Object.entries(environment).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
        resolve(`apps/mobile/maestro/${flow}.yaml`),
      ],
      { stdio: 'inherit' },
    )
    const result = await new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', resolveExit)
    })
    if (result !== 0)
      throw new Error(`Mobile multi-device verification failed in ${flow} (${result})`)
  }
  await runFlow('multi-device-first', {
    FIRST_ADDRESS: first.connection.address,
    FIRST_CODE: first.pairing.code,
  })
  // Keep the original scoped draft, then make a long settled list for return navigation.
  await first.request(
    '/api/workspace',
    {
      collection: 'tasks',
      id: 'shared-task',
      changes: { archived: { before: null, after: true } },
    },
    'PATCH',
  )
  for (let index = 1; index <= 18; index++) {
    const id = `history-${index}`
    await first.request(
      '/api/workspace',
      {
        collection: 'tasks',
        id,
        changes: {},
        create: {
          id,
          title: `A history host task ${String(index).padStart(2, '0')}`,
          repositoryId: 'shared-repo',
          agentId: 'shared-agent',
          execution: 'main',
          status: 'draft',
          archived: true,
          createdAt: new Date().toISOString(),
          messages: [],
          files: [],
          draft: '',
          example: false,
        },
      },
      'PATCH',
    )
  }
  // Pairing codes retain their production TTL; issue the second only when its UI phase starts.
  const secondCode = await second.request('/api/pair/code', { autoApprove: true })
  await runFlow('multi-device', {
    FIRST_ADDRESS: first.connection.address,
    SECOND_ADDRESS: second.connection.address,
    SECOND_CODE: secondCode.code,
  })
  const [firstSnapshot, secondSnapshot] = await Promise.all([
    first.request('/api/snapshot'),
    second.request('/api/snapshot'),
  ])
  const firstTask = firstSnapshot.workspace.tasks.find((task) => task.id === 'shared-task')
  const secondTask = secondSnapshot.workspace.tasks.find((task) => task.id === 'shared-task')
  if (firstTask.messages.length || firstTask.turns?.length)
    throw new Error('The first computer received work intended for the second computer')
  if (
    secondTask.messages.filter(
      (message) => message.role === 'user' && message.text === 'Work only on the second computer',
    ).length !== 1
  )
    throw new Error('The second computer did not receive its message exactly once')
  console.log(
    'Mobile multi-device pairing, saved connections, task aggregation, host routing, isolated drafts, retained list search/filters/sort/scroll, and cold launch verified.',
  )
} finally {
  await Promise.all([first?.stop(), second?.stop()])
  await rm(directory, { recursive: true, force: true })
}
