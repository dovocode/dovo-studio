import { mkdir, copyFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import type { AgentInput, AgentRun } from '../agents/execution/types.js'
import type { SandboxSession } from './launcher.js'

type Attachments = AgentRun['attachments']

/** Attachments live in Dovo's data directory, which the container cannot see. Copy them into
 * the thread's mounted state directory and point the harness at the copies. */
async function sandboxAttachments(session: SandboxSession, attachments: Attachments) {
  if (!attachments?.length) return attachments
  const directory = join(session.stateDirectory, 'attachments', randomUUID())
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return Promise.all(
    attachments.map(async (file, index) => {
      const target = join(directory, `${index}-${basename(file.path)}`)
      await copyFile(file.path, target)
      return { ...file, path: target }
    }),
  )
}

/** A run whose harness processes start inside the thread's container. */
export async function sandboxRun(run: AgentRun, session: SandboxSession): Promise<AgentRun> {
  const onSteer = run.onSteer
  return {
    ...run,
    sandbox: session,
    prepareSandbox: undefined,
    attachments: await sandboxAttachments(session, run.attachments),
    ...(onSteer
      ? {
          onSteer: (steer) =>
            onSteer(
              steer &&
                (async (input: AgentInput) =>
                  steer({
                    ...input,
                    attachments: await sandboxAttachments(session, input.attachments),
                  })),
            ),
        }
      : {}),
  }
}
