import { decode, secureInputCommandSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import type { Services } from '../services.js'
import { acpAuthenticationJobs } from '../http/endpoints/acp-routes.js'
import { runSecureCommand } from './secure-command.js'

export async function secureInputTool(s: Services, value: unknown, runId: string) {
  const { taskId, command } = decode(
    mutableStruct({
      taskId: Schema.String,
      command: secureInputCommandSchema,
    }),
    value,
  )
  if (command.action === 'status') return s.secureInputs.status(taskId, command.id)
  if (command.action === 'cancel') return s.secureInputs.cancel(taskId, command.id)
  const replay = s.secureInputs.replay(taskId, runId, command)
  if (replay) return replay
  const signal = AbortSignal.any([s.tasks.humanInputSignal(taskId, runId), s.acpController.signal])
  const directory = await s.checkouts.directory(taskId, signal)
  const destination = command.destination
  const consume =
    destination.kind === 'command'
      ? (value: string, signal: AbortSignal) =>
          runSecureCommand(destination, directory, value, signal)
      : acpAuthenticationJobs(s).callbackConsumer(destination.installationId)
  return s.secureInputs.request(taskId, runId, command, directory, signal, consume)
}
