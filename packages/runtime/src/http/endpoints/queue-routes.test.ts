import { expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import { startRuntime } from '../../index'
import { HttpError } from '../../errors'

it('validates and applies a drag move in one queue request', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({ title: 'Sort queue', repositoryId: '', agentId: '', objective: '' })
    store.updateTask(task.id, (current) => ({ ...current, queuePaused: true }))
    tasks.queue.add(task.id, 'first', 'First')
    tasks.queue.add(task.id, 'second', 'Second')
    tasks.queue.add(task.id, 'third', 'Third')
    const move = (input: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, action: 'move', ...input }),
      })
    expect((await move({ messageId: 'third', beforeMessageId: 'first' })).status).toBe(200)
    expect(store.taskSummary(task.id).queue?.map((message) => message.id)).toEqual([
      'third',
      'first',
      'second',
    ])
    expect((await move({ messageId: 'first', beforeMessageId: null })).status).toBe(200)
    expect((await move({ messageId: 'first' })).status).toBe(400)
    expect((await move({ beforeMessageId: null })).status).toBe(400)
    expect((await move({ messageId: 'first', beforeMessageId: 'missing' })).status).toBe(409)
    expect((await move({ messageId: 'missing', beforeMessageId: null })).status).toBe(409)
    expect(store.taskSummary(task.id).queue?.map((message) => message.id)).toEqual([
      'third',
      'second',
      'first',
    ])
    expect(store.taskSummary(task.id).queuePaused).toBe(true)
  } finally {
    await runtime.close()
  }
})

it('accepts and edits one-turn model choices, rejects invalid harnesses and prevents steering overrides', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({
      title: 'Turn choices',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    store.updateTask(task.id, (t) => ({
      ...t,
      status: 'running',
      queuePaused: true,
      harness: { provider: 'codex', model: '', endpoint: '', instructions: '', permission: 'ask' },
    }))
    const request = (path: string, input: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, ...input }),
      })
    const settings = { provider: 'codex', model: 'model-large', reasoning: 'high' }
    expect(
      (await request('message', { messageId: 'one', text: 'One', turnSettings: settings })).status,
    ).toBe(200)
    expect(store.task(task.id).queue?.[0].turnSettings).toEqual(settings)
    expect(
      (
        await request('message', {
          messageId: 'one',
          text: 'One',
          turnSettings: { ...settings, reasoning: 'low' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request('message', {
          messageId: 'wrong',
          text: 'Wrong',
          turnSettings: { ...settings, provider: 'claude' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request('message', {
          messageId: 'invalid',
          text: 'Invalid',
          turnSettings: { ...settings, permission: 'yolo' },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request('steer', {
          messageId: 'steer',
          text: 'Steer',
          runId: 'run',
          turnSettings: settings,
        })
      ).status,
    ).toBe(409)
    expect(
      (await request('queue', { action: 'steer', messageId: 'one', runId: 'run' })).status,
    ).toBe(409)
    const edit = {
      action: 'edit',
      messageId: 'one',
      text: 'One',
      expectedText: 'One',
      turnSettings: { ...settings, reasoning: 'low' },
      expectedTurnSettings: settings,
    }
    expect((await request('queue', edit)).status).toBe(200)
    expect((await request('queue', edit)).status).toBe(409)
    expect(
      (
        await request('queue', {
          ...edit,
          turnSettings: null,
          expectedTurnSettings: { ...settings, reasoning: 'low' },
        })
      ).status,
    ).toBe(200)
    expect(store.task(task.id).queue?.[0].turnSettings).toBeUndefined()
  } finally {
    await runtime.close()
  }
})

it('edits all turn settings and attachments while preserving queue position and the ordinary draft', async () => {
  const ownerToken = 'queue-edit-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks, attachments } = runtime.services
    const task = tasks.create({
      title: 'Edit in composer',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    const harness = {
      provider: 'codex' as const,
      model: 'default',
      endpoint: '',
      instructions: '',
      permission: 'ask' as const,
    }
    store.updateTask(task.id, (current) => ({
      ...current,
      status: 'running',
      queuePaused: true,
      draft: 'Keep my draft',
      harness,
    }))
    tasks.queue.add(task.id, 'first', 'First')
    tasks.queue.add(task.id, 'edit', 'Original')
    const ordinary = await attachments.upload({
      taskId: task.id,
      id: crypto.randomUUID(),
      name: 'draft.txt',
      data: Buffer.from('Draft').toString('base64'),
    })
    const file = await attachments.upload({
      taskId: task.id,
      queuedMessageId: 'edit',
      id: crypto.randomUUID(),
      name: 'queued.txt',
      data: Buffer.from('Queued').toString('base64'),
    })
    await attachments.prune()
    expect(attachments.read(task.id, file.attachment.id).attachment).toEqual(file.attachment)
    expect(store.task(task.id).draftAttachments).toEqual([ordinary.attachment])
    const settings = {
      provider: 'codex',
      model: 'large',
      reasoning: 'high',
      harness: {
        ...harness,
        model: 'large',
        reasoning: 'high',
        serviceTier: 'priority',
        permission: 'read-only',
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        instructions: 'Review only',
      },
    }
    const edit = {
      id: task.id,
      action: 'edit',
      messageId: 'edit',
      text: 'Changed',
      expectedText: 'Original',
      turnSettings: settings,
      expectedTurnSettings: null,
      attachmentIds: [file.attachment.id],
      expectedAttachmentIds: [],
    }
    const request = (input: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    expect((await request(edit)).status).toBe(200)
    const after = store.task(task.id)
    expect(after.queue?.map((message) => message.id)).toEqual(['first', 'edit'])
    expect(after.queue?.[1]).toMatchObject({
      text: 'Changed',
      turnSettings: settings,
      attachments: [file.attachment],
    })
    expect(after.draft).toBe('Keep my draft')
    expect(after.draftAttachments).toEqual([ordinary.attachment])
    expect(after.harness).toEqual(harness)
    expect(after.queuePaused).toBe(true)
    expect(
      (
        await request({
          ...edit,
          text: 'Stale attachment edit',
          expectedText: 'Changed',
          expectedTurnSettings: settings,
        })
      ).status,
    ).toBe(409)
    tasks.queue.take(task.id, 'first-run')
    tasks.queue.take(task.id, 'edited-run')
    expect(store.task(task.id).runAttempt?.turnSettings).toEqual(settings)
    await expect(
      attachments.upload({
        taskId: task.id,
        queuedMessageId: 'edit',
        id: crypto.randomUUID(),
        name: 'late.txt',
        data: '',
      }),
    ).rejects.toThrow('already started')
  } finally {
    await runtime.close()
  }
})

it('pauses and resumes one queued message, validates stale ids, and preserves other pauses', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({
      title: 'Individual pauses',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    store.updateTask(task.id, (current) => ({ ...current, status: 'running' }))
    tasks.queue.add(task.id, 'first', 'First')
    tasks.queue.add(task.id, 'second', 'Second')
    const change = (action: string, messageId?: string) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, action, messageId }),
      })
    expect((await change('pause-message', 'first')).status).toBe(200)
    expect((await change('pause-message', 'second')).status).toBe(200)
    expect((await change('pause-message', 'first')).status).toBe(200)
    expect(store.taskSummary(task.id).queuePaused).toBeFalsy()
    expect((await change('resume-message', 'first')).status).toBe(200)
    expect(store.taskSummary(task.id).queue?.map((message) => !!message.paused)).toEqual([
      false,
      true,
    ])
    expect((await change('pause-message')).status).toBe(400)
    expect((await change('resume-message')).status).toBe(400)
    expect((await change('pause-message', 'gone')).status).toBe(409)
    expect((await change('resume-message', 'gone')).status).toBe(409)
    expect((await change('pause-message', 'first')).status).toBe(200)
    expect((await change('resume')).status).toBe(200)
    expect(store.taskSummary(task.id).queue?.every((message) => message.paused)).toBe(true)
    expect(store.task(task.id).messages).toEqual([])
  } finally {
    await runtime.close()
  }
})

it.each(['move', 'up', 'down', 'remove', 'restore'] as const)(
  'continues a queue unblocked by %s without overriding safety pauses',
  async (action) => {
    const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
    const { store, tasks } = runtime.services
    const start = vi.spyOn(tasks, 'startEffect').mockImplementation((_id, _pause, admit) => {
      expect(admit?.()).toBe(true)
      return Effect.succeed({ completion: Effect.void })
    })
    try {
      for (const blocked of ['none', 'global', 'running', 'archived', 'recovery'] as const) {
        const task = tasks.create({
          title: 'Blocked queue',
          repositoryId: '',
          agentId: '',
          objective: '',
        })
        tasks.queue.add(task.id, 'held', 'Held')
        tasks.queue.add(task.id, 'ready', 'Ready')
        tasks.queue.setPaused(task.id, 'held', true)
        store.updateTask(task.id, (current) => ({
          ...current,
          status: blocked === 'running' ? 'running' : 'done',
          queuePaused: blocked === 'global',
          archived: blocked === 'archived',
          ...(blocked === 'recovery'
            ? { restartRecovery: { kind: 'queue', automatic: false } }
            : {}),
        }))
        start.mockClear()
        const response = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: task.id,
            action,
            messageId: action === 'up' ? 'ready' : 'held',
            ...(action === 'move' ? { beforeMessageId: null } : {}),
          }),
        })
        // Reordering an archived queue is refused; removal and restore remain available.
        const refused = blocked === 'archived' && ['move', 'up', 'down'].includes(action)
        expect(response.status).toBe(refused ? 409 : 200)
        expect(store.taskSummary(task.id).queue?.[0]?.id).toBe(refused ? 'held' : 'ready')
        expect(start).toHaveBeenCalledTimes(blocked === 'none' ? 1 : 0)
        expect(store.taskSummary(task.id).queuePaused).toBe(blocked === 'global')
      }
    } finally {
      start.mockRestore()
      await runtime.close()
    }
  },
)

it('validates duplicate requests and safely replays the accepted copy', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({ title: 'Copy queue', repositoryId: '', agentId: '', objective: '' })
    store.updateTask(task.id, (t) => ({ ...t, queuePaused: true, draft: 'Keep draft' }))
    tasks.queue.add(task.id, 'source', 'Original')
    const request = (input: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, action: 'duplicate', ...input }),
      })
    expect((await request({ messageId: 'source' })).status).toBe(400)
    expect((await request({ duplicateMessageId: 'copy' })).status).toBe(400)
    expect((await request({ messageId: 'source', duplicateMessageId: 'copy' })).status).toBe(200)
    tasks.queue.change(task.id, 'remove', 'source')
    expect((await request({ messageId: 'source', duplicateMessageId: 'copy' })).status).toBe(200)
    expect((await request({ messageId: 'source', duplicateMessageId: 'other-copy' })).status).toBe(
      409,
    )
    expect(store.task(task.id)).toMatchObject({
      draft: 'Keep draft',
      queuePaused: true,
      queue: [{ id: 'copy', text: 'Original' }],
    })
  } finally {
    await runtime.close()
  }
})

it('acknowledges a restored queue message after response loss without changing newer drafts or starting work', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({ title: 'Restore', repositoryId: '', agentId: '', objective: '' })
    store.updateTask(task.id, (t) => ({ ...t, queuePaused: true, draft: 'Existing draft' }))
    tasks.queue.add(task.id, 'queued', 'Queued text')
    const input = {
      id: task.id,
      action: 'restore',
      messageId: 'queued',
      restoreRequestId: 'restore-operation',
      expectedText: 'Queued text',
      expectedTurnSettings: null,
      expectedDraftTurnSettings: null,
      expectedAttachmentIds: [],
    }
    const request = (value: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      })
    expect((await request({ ...input, expectedText: 'Stale text' })).status).toBe(409)
    expect(store.taskSummary(task.id).queue).toHaveLength(1)
    // A rejection before commit has no receipt; retrying the corrected intent remains safe.
    expect((await request(input)).status).toBe(200)
    expect(store.taskSummary(task.id).draft).toBe('Existing draft\n\nQueued text')
    expect(store.taskSummary(task.id).queue).toEqual([])
    store.updateTask(task.id, (t) => ({ ...t, draft: 'New draft', queuePaused: false }))
    const start = vi.spyOn(tasks, 'startEffect')
    expect((await request(input)).status).toBe(200)
    expect(start).not.toHaveBeenCalled()
    expect(store.taskSummary(task.id).draft).toBe('New draft')
    expect((await request({ ...input, expectedText: 'Different text' })).status).toBe(409)
    expect((await request({ ...input, restoreRequestId: 'new-operation' })).status).toBe(409)
    expect((await request({ ...input, expectedAttachmentIds: undefined })).status).toBe(400)
    start.mockRestore()
  } finally {
    await runtime.close()
  }
})

it('rejects reorders against a stale queue order, including a baseline taken before up or down', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({
      title: 'Stale order',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    store.updateTask(task.id, (current) => ({ ...current, queuePaused: true }))
    for (const id of ['first', 'second', 'third']) tasks.queue.add(task.id, id, id)
    const request = (input: Record<string, unknown>, mutationId?: string) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
          ...(mutationId ? { 'x-dovo-mutation-id': mutationId } : {}),
        },
        body: JSON.stringify({ id: task.id, ...input }),
      })
    const order = () => store.taskSummary(task.id).queue?.map((message) => message.id)
    const rejected = async (response: Response) => {
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ mutationRejected: true })
    }
    const status = await fetch(`http://127.0.0.1:${runtime.port}/api/mutations/status`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(await status.json()).toMatchObject({ queueMutations: 1 })
    const initial = ['first', 'second', 'third']
    expect(
      (
        await request({
          action: 'move',
          messageId: 'third',
          beforeMessageId: 'first',
          expectedMessageIds: initial,
        })
      ).status,
    ).toBe(200)
    expect(order()).toEqual(['third', 'first', 'second'])
    // A second drag computed from the same old order must not land against the new order.
    await rejected(
      await request({
        action: 'move',
        messageId: 'second',
        beforeMessageId: null,
        expectedMessageIds: initial,
      }),
    )
    // Relative controls must also honor a supplied stale order.
    for (const action of ['up', 'down']) {
      await rejected(await request({ action, messageId: 'second', expectedMessageIds: initial }))
      expect(order()).toEqual(['third', 'first', 'second'])
    }
    // A subset or reordered baseline is not the full current order.
    await rejected(
      await request({
        action: 'move',
        messageId: 'second',
        beforeMessageId: null,
        expectedMessageIds: ['third', 'first'],
      }),
    )
    expect(order()).toEqual(['third', 'first', 'second'])
    const beforeUp = order()
    expect((await request({ action: 'up', messageId: 'first' })).status).toBe(200)
    expect(order()).toEqual(['first', 'third', 'second'])
    expect((await request({ action: 'down', messageId: 'first' })).status).toBe(200)
    expect(order()).toEqual(['third', 'first', 'second'])
    expect((await request({ action: 'down', messageId: 'first' })).status).toBe(200)
    expect(order()).toEqual(['third', 'second', 'first'])
    // The same client's drag from before its own up/down presses is stale too.
    await rejected(
      await request({
        action: 'move',
        messageId: 'third',
        beforeMessageId: null,
        expectedMessageIds: beforeUp,
      }),
    )
    expect(order()).toEqual(['third', 'second', 'first'])

    const current = order()
    const fresh = {
      action: 'move',
      messageId: 'first',
      beforeMessageId: 'third',
      expectedMessageIds: current,
    }
    expect((await request(fresh, 'move-receipt')).status).toBe(200)
    expect(order()).toEqual(['first', 'third', 'second'])
    // A lost acknowledgement replays the stored success, not the now-stale order check.
    expect((await request(fresh, 'move-receipt')).status).toBe(200)
    expect(order()).toEqual(['first', 'third', 'second'])
    await rejected(await request(fresh, 'stale-move-receipt'))
    // The recorded rejection stays a rejection when the journal retries it.
    await rejected(await request(fresh, 'stale-move-receipt'))
    expect(order()).toEqual(['first', 'third', 'second'])
    expect(store.taskSummary(task.id).queuePaused).toBe(true)
  } finally {
    await runtime.close()
  }
})

it('refuses to reorder or duplicate around a steering message or in an archived thread', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({ title: 'Guards', repositoryId: '', agentId: '', objective: '' })
    store.updateTask(task.id, (current) => ({ ...current, status: 'running', queuePaused: true }))
    for (const id of ['steering', 'waiting', 'last']) tasks.queue.add(task.id, id, id)
    const request = (input: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, ...input }),
      })
    const attempts = [
      { action: 'move', messageId: 'last', beforeMessageId: 'steering' },
      { action: 'move', messageId: 'waiting', beforeMessageId: null },
      { action: 'up', messageId: 'waiting' },
      { action: 'down', messageId: 'waiting' },
      { action: 'down', messageId: 'steering' },
    ]
    const before = store.task(task.id).queue
    store.updateTask(task.id, (current) => ({
      ...current,
      queue: current.queue?.map((message) =>
        message.id === 'steering' ? { ...message, steering: true } : message,
      ),
    }))
    const steeringQueue = store.task(task.id).queue
    for (const attempt of attempts) {
      const response = await request(attempt)
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ mutationRejected: true })
    }
    expect(
      (await request({ action: 'duplicate', messageId: 'steering', duplicateMessageId: 'copy' }))
        .status,
    ).toBe(409)
    expect(store.task(task.id).queue).toEqual(steeringQueue)

    store.updateTask(task.id, (current) => ({
      ...current,
      status: 'review',
      archived: true,
      queue: before,
    }))
    for (const attempt of [
      ...attempts,
      { action: 'duplicate', messageId: 'waiting', duplicateMessageId: 'archived-copy' },
    ]) {
      const response = await request(attempt)
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ mutationRejected: true })
    }
    expect(store.task(task.id).queue).toEqual(before)
  } finally {
    await runtime.close()
  }
})

it('retries an uncertain duplicate receipt into its own stable copy instead of a second copy', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({ title: 'Copy once', repositoryId: '', agentId: '', objective: '' })
    store.updateTask(task.id, (current) => ({ ...current, queuePaused: true }))
    tasks.queue.add(task.id, 'source', 'Original')
    tasks.queue.add(task.id, 'after', 'After')
    const request = (input: Record<string, unknown>, mutationId: string) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
          'x-dovo-mutation-id': mutationId,
        },
        body: JSON.stringify({ id: task.id, action: 'duplicate', ...input }),
      })
    const duplicate = tasks.queue.duplicate.bind(tasks.queue)
    // The copy commits, then the runtime fails before recording the receipt outcome.
    vi.spyOn(tasks.queue, 'duplicate').mockImplementationOnce((...input) => {
      duplicate(...input)
      throw new Error('Connection lost after commit')
    })
    const input = { messageId: 'source', duplicateMessageId: 'copy' }
    expect((await request(input, 'duplicate-receipt')).status).toBe(500)
    expect(store.taskSummary(task.id).queue?.map((message) => message.id)).toEqual([
      'source',
      'copy',
      'after',
    ])
    expect((await request(input, 'duplicate-receipt')).status).toBe(200)
    expect((await request(input, 'duplicate-receipt')).status).toBe(200)
    // A fresh journal entry for the same copy id is also a replay, not another copy.
    expect((await request(input, 'other-receipt')).status).toBe(200)
    await expect(
      request({ ...input, messageId: 'after' }, 'reused-copy-id'),
    ).resolves.toMatchObject({ status: 409 })
    expect(store.task(task.id).queue).toMatchObject([
      { id: 'source', text: 'Original' },
      { id: 'copy', text: 'Original' },
      { id: 'after', text: 'After' },
    ])
    expect(store.taskSummary(task.id).queuePaused).toBe(true)
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
  }
})

it('acknowledges a committed move when starting the newly unblocked queue fails', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { tasks, store } = runtime.services
    const task = tasks.create({ title: 'Unblock', repositoryId: '', agentId: '', objective: '' })
    tasks.queue.add(task.id, 'paused', 'Wait')
    tasks.queue.add(task.id, 'ready', 'Ready')
    tasks.queue.setPaused(task.id, 'paused', true)
    store.updateTask(task.id, (current) => ({ ...current, status: 'review' }))
    const start = vi
      .spyOn(tasks, 'startEffect')
      .mockReturnValue(Effect.fail(new HttpError(503, 'Runtime is restarting')))
    const move = () =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
          'x-dovo-mutation-id': 'unblock-order',
        },
        body: JSON.stringify({
          id: task.id,
          action: 'move',
          messageId: 'ready',
          beforeMessageId: 'paused',
          expectedMessageIds: ['paused', 'ready'],
        }),
      })
    const response = await move()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, queueMessageIds: ['ready', 'paused'] })
    expect(store.taskSummary(task.id)).toMatchObject({
      queuePaused: true,
      error: 'Queue updated. Could not start: Runtime is restarting',
    })
    expect((await move()).status).toBe(200)
    expect(start).toHaveBeenCalledTimes(1)
    start.mockRestore()
  } finally {
    await runtime.close()
  }
})

it('settles saved queue actions for a deleted thread without leaving an uncertain receipt', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    for (const action of ['duplicate', 'move']) {
      const request = () =>
        fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ownerToken}`,
            'Content-Type': 'application/json',
            'x-dovo-mutation-id': `deleted-${action}`,
          },
          body: JSON.stringify({
            id: 'deleted-thread',
            action,
            messageId: 'source',
            duplicateMessageId: 'copy',
            beforeMessageId: null,
          }),
        })
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request()
        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ mutationRejected: true })
      }
    }
  } finally {
    await runtime.close()
  }
})

it('keeps review mode when duplicating a review prompt without changing prompt recency', async () => {
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'review-copy-owner-token-at-least-thirty-two-characters',
    port: 0,
  })
  try {
    const { tasks, store } = runtime.services
    const task = tasks.create({ title: 'Review', repositoryId: '', agentId: '', objective: '' })
    store.updateTask(task.id, (current) => ({
      ...current,
      lastPromptAt: '2026-01-01T00:00:00.000Z',
      queuePaused: true,
    }))
    tasks.queue.add(task.id, 'review', 'Review the changes', [], undefined, true)
    tasks.queue.duplicate(task.id, 'review', 'review-copy')
    expect(store.taskSummary(task.id).queue?.[1]).toMatchObject({
      id: 'review-copy',
      review: true,
      source: { kind: 'user' },
    })
    expect(store.taskSummary(task.id).lastPromptAt).toBe('2026-01-01T00:00:00.000Z')
  } finally {
    await runtime.close()
  }
})
