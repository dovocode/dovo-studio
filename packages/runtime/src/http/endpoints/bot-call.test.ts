import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { createBotCall, type BotCallAudio } from '@dovo/client-runtime'
import { botCallReplies, botResultSchema, decode } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'
it('delivers a voice request through real HTTP and queue once after a lost acknowledgement, preserving the Bot draft', async () => {
  const f = await setupBotRuntime(),
    s = f.runtime.services
  const { id } = decode(botResultSchema, await (await f.create()).response.json())
  s.store.updateTask(id, (task) => ({ ...task, draft: 'My unfinished text' }))
  let finish!: (text: string) => void
  const spoken: string[] = [],
    sent: string[] = []
  let lost = true
  const audio: BotCallAudio = {
    listen: async (_signal, events) => {
      finish = events.finish
    },
    speak: async (text) => {
      spoken.push(text)
    },
  }
  const call = createBotCall(
    audio,
    async (messageId, text) => {
      sent.push(messageId)
      const response = await f.request('/api/tasks/message', {
        id,
        messageId,
        text,
        preserveQueuePause: true,
      })
      expect(response.status).toBe(200)
      if (lost) {
        lost = false
        throw Error('Response lost')
      }
    },
    randomUUID,
  )
  try {
    call.start()
    await waitForRuntime(() => expect(finish).toBeTypeOf('function'))
    finish('Please check the release')
    await waitForRuntime(() => expect(call.getSnapshot().phase).toBe('error'))
    await waitForRuntime(() => expect(s.store.taskSummary(id).status).toBe('review'))
    call.sync(botCallReplies(s.store.task(id), call.requests()), {
      available: true,
      needsInput: false,
    })
    call.retry()
    await waitForRuntime(() => expect(spoken).toEqual(['Done']))
    expect(sent).toHaveLength(2)
    expect(sent[0]).toBe(sent[1])
    expect(s.store.task(id).messages.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(f.runtime.run).toHaveBeenCalledTimes(1)
    expect(s.store.task(id).draft).toBe('My unfinished text')
    expect(s.store.task(id).title).toBe('Release helper')
  } finally {
    call.end()
  }
})
