import { expect, it } from 'vite-plus/test'
import type { AgentRun } from '../../execution/types.js'
import { AcpV2Updates } from './acp-v2-updates.js'
import { providerFixture } from '../shared/provider-fixture.js'
import { rm } from 'node:fs/promises'

it('applies interleaved message replacements, omitted fields and explicit clears', async () => {
  const f = await providerFixture('acp', '')
  try {
    const endings: string[] = []
    const view = new AcpV2Updates(f.run, (reason) => endings.push(reason))
    const chunk = (messageId: string, text: string) =>
      view.accept({
        sessionId: 's',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId,
          content: { type: 'text', text },
        },
      })
    chunk('a', 'A')
    chunk('b', 'B')
    chunk('a', '1')
    expect(f.output.join('')).toBe('A1B')
    view.accept({ sessionId: 's', update: { sessionUpdate: 'agent_message', messageId: 'a' } })
    expect(f.output.join('')).toBe('A1B')
    view.accept({
      sessionId: 's',
      update: { sessionUpdate: 'agent_message', messageId: 'a', content: null },
    })
    expect(f.output.join('')).toBe('B')
    view.accept({
      sessionId: 's',
      update: { sessionUpdate: 'agent_message', messageId: 'b', content: [] },
    })
    expect(f.output.join('')).toBe('')
    view.accept({ sessionId: 's', update: { sessionUpdate: '_future', opaque: true } })
    view.accept({
      sessionId: 's',
      update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' },
    })
    expect(endings).toEqual([])
    view.accept({ sessionId: 's', update: { sessionUpdate: 'state_update', state: 'running' } })
    view.accept({ sessionId: 's', update: { sessionUpdate: 'state_update', state: 'idle' } })
    view.accept({
      sessionId: 's',
      update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' },
    })
    expect(endings).toEqual(['end_turn'])
  } finally {
    await rm(f.cwd, { recursive: true, force: true })
  }
})

it('upserts tools, patches metadata by key and replaces streamed tool content', async () => {
  const f = await providerFixture('acp', '')
  try {
    const view = new AcpV2Updates(f.run, () => {})
    view.accept({
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't',
        title: 'Read',
        kind: 'read',
        _meta: { keep: 1, remove: 2 },
      },
    })
    view.accept({
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call_content_chunk',
        toolCallId: 't',
        content: { type: 'content', content: { type: 'text', text: 'partial' } },
      },
    })
    view.accept({
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't',
        title: null,
        content: [],
        _meta: { remove: null, new: 3 },
      },
    })
    expect(view.tools.get('t')).toMatchObject({
      title: null,
      kind: 'read',
      content: [],
      _meta: { keep: 1, new: 3 },
    })
    expect(view.tools.get('t')?._meta).not.toHaveProperty('remove')
    view.accept({
      sessionId: 's',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 't', _meta: null },
    })
    expect(view.tools.get('t')?._meta).toBeNull()
  } finally {
    await rm(f.cwd, { recursive: true, force: true })
  }
})

it('decodes fragmented terminal bytes and replaces snapshots without creating execution controls', async () => {
  const f = await providerFixture('acp', '')
  try {
    const events: Array<{ name: string; payload: unknown }> = []
    const run: AgentRun = { ...f.run, onEvent: (name, payload) => events.push({ name, payload }) }
    const view = new AcpV2Updates(run, () => {})
    const bytes = Buffer.from('❤️')
    for (const part of [bytes.subarray(0, 2), bytes.subarray(2)])
      view.accept({
        sessionId: 's',
        update: {
          sessionUpdate: 'terminal_output_chunk',
          terminalId: 't',
          data: part.toString('base64'),
        },
      })
    expect(JSON.stringify(events.at(-1))).toContain('❤️')
    view.accept({
      sessionId: 's',
      update: {
        sessionUpdate: 'terminal_update',
        terminalId: 't',
        output: { data: Buffer.from('reset').toString('base64') },
        exitStatus: { exitCode: 0 },
      },
    })
    expect(JSON.stringify(events.at(-1))).toContain('reset')
    expect(JSON.stringify(events.at(-1))).not.toContain('❤️')
    expect(events.at(-1)?.name).toBe('tool_call_update')
  } finally {
    await rm(f.cwd, { recursive: true, force: true })
  }
})

it('retains session tool patches across turns and keeps idle text out of the next reply', async () => {
  const f = await providerFixture('acp', '')
  try {
    const view = new AcpV2Updates(f.run, () => {})
    view.accept({
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't',
        title: 'Background work',
        kind: 'read',
      },
    })
    view.accept(
      {
        sessionId: 's',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'background',
          content: { type: 'text', text: 'old idle text' },
        },
      },
      false,
    )
    view.begin(f.run, () => {})
    view.accept({
      sessionId: 's',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed' },
    })
    expect(view.tools.get('t')).toMatchObject({
      title: 'Background work',
      kind: 'read',
      status: 'completed',
    })
    view.accept({
      sessionId: 's',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'new',
        content: { type: 'text', text: 'new reply' },
      },
    })
    expect(f.output.join('')).toBe('new reply')
  } finally {
    await rm(f.cwd, { recursive: true, force: true })
  }
})

it('replaces each item plan by ID and keeps other plans in the shared checklist', async () => {
  const f = await providerFixture('acp', '')
  try {
    const view = new AcpV2Updates(f.run, () => {})
    const plan = (planId: string, content: string, status: 'pending' | 'completed') =>
      view.accept({
        sessionId: 's',
        update: {
          sessionUpdate: 'plan_update',
          plan: { type: 'items', planId, entries: [{ content, status, priority: 'medium' }] },
        },
      })
    plan('first', 'One', 'pending')
    plan('second', 'Two', 'pending')
    plan('first', 'One revised', 'completed')
    expect(f.events.filter((event) => event.name === 'plan').at(-1)?.value).toEqual({
      sessionId: 's',
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: 'One revised', status: 'completed', priority: 'medium' },
          { content: 'Two', status: 'pending', priority: 'medium' },
        ],
      },
    })
  } finally {
    await rm(f.cwd, { recursive: true, force: true })
  }
})
