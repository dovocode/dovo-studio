import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from 'vscode-jsonrpc/node'
import { createAgentPlatform, Cursor } from '@cursor/sdk'
import { cursorInputSchema, cursorModels, cursorSession } from './cursor-runtime.js'
import { z } from 'zod'

const rpc = createMessageConnection(new IPCMessageReader(process), new IPCMessageWriter(process))
const session = cursorSession((event) => {
  void rpc.sendNotification('event', event)
})
rpc.onRequest('models', async () => cursorModels(await Cursor.models.list()))
rpc.onRequest('probe', async () => {
  await Cursor.me()
  return { authenticated: true }
})
rpc.onRequest('run', async (input: unknown) => session.run(cursorInputSchema.parse(input)))
rpc.onRequest('steer', async (text: unknown) => session.steer(z.string().parse(text)))
rpc.onRequest('cancel', async () => session.cancel())
rpc.onRequest<boolean, unknown>('checkpoint', async (raw: unknown) => {
  const { cwd, sessionId, runId } = z
    .object({ cwd: z.string().min(1), sessionId: z.string().min(1), runId: z.string().min(1) })
    .parse(raw)
  const { store } = await createAgentPlatform({ workspaceRef: cwd })
  const run = await store.getRun(sessionId, runId)
  const latest = run?.latestCheckpointRef?.blobId
  return !!latest && latest !== run?.startCheckpointRef?.blobId
})
process.on('disconnect', () => {
  void session.cancel().finally(() => process.exit())
})
rpc.listen()
