import { afterEach, expect, it, vi } from 'vite-plus/test'
import { StudioSessions } from './ui-sessions.js'
afterEach(() => vi.useRealTimers())
it('delivers commands to one explicitly selected paired session and resolves its result', async () => {
  vi.useFakeTimers()
  const sessions = new StudioSessions(() => true)
  const check = vi.fn<() => void>()
  const poll = sessions.poll('device-a', { sessionId: 'studio-a', label: 'Desktop' }, check)
  const result = sessions.command('studio-a', { action: 'snapshot', sessionId: 'studio-a' }, check)
  const { job } = await poll
  expect(job?.command.action).toBe('snapshot')
  expect(() =>
    sessions.command('studio-a', { action: 'snapshot', sessionId: 'studio-a' }, check),
  ).toThrow('busy')
  expect(job).not.toBeNull()
  const next = sessions.poll(
    'device-a',
    {
      sessionId: 'studio-a',
      label: 'Desktop',
      result: { id: job?.id ?? '', value: { text: 'Current UI' } },
    },
    check,
  )
  expect(await result).toEqual({ text: 'Current UI' })
  await vi.advanceTimersByTimeAsync(15000)
  expect(await next).toEqual({ job: null })
  await expect(
    sessions.poll('device-b', { sessionId: 'studio-a', label: 'Imposter' }, check),
  ).rejects.toThrow('another device')
  await vi.advanceTimersByTimeAsync(45001)
  expect(sessions.list()).toEqual([])
})
it('revalidates a queued command before delivery and rejects revoked access', async () => {
  vi.useFakeTimers()
  const sessions = new StudioSessions(() => true)
  const register = sessions.poll('device', { sessionId: 'studio', label: 'Web' }, () => {})
  await vi.advanceTimersByTimeAsync(15000)
  await register
  let revoked = false
  const result = sessions.command('studio', { action: 'snapshot', sessionId: 'studio' }, () => {
    if (revoked) throw new Error('Revoked')
  })
  const rejection = result.then(
    () => undefined,
    (error: unknown) => error,
  )
  revoked = true
  const poll = sessions.poll('device', { sessionId: 'studio', label: 'Web' }, () => {})
  expect(await poll).toEqual({ job: null })
  expect(await rejection).toMatchObject({ message: 'Revoked' })
})
it('rejects disabled sessions and expires commands without silently replaying them', async () => {
  vi.useFakeTimers()
  let enabled = true
  const sessions = new StudioSessions(() => enabled)
  const poll = sessions.poll('device', { sessionId: 'studio', label: 'Web' }, () => {})
  await vi.advanceTimersByTimeAsync(15000)
  await poll
  const result = sessions.command(
    'studio',
    { action: 'click', sessionId: 'studio', selector: 'button' },
    () => {},
  )
  const rejection = result.then(
    () => undefined,
    (error: unknown) => error,
  )
  await vi.advanceTimersByTimeAsync(20000)
  expect(await rejection).toMatchObject({
    message: expect.stringContaining('outcome may be unknown'),
  })
  enabled = false
  await expect(
    sessions.poll('device', { sessionId: 'studio', label: 'Web' }, () => {}),
  ).rejects.toThrow('disabled')
  expect(() =>
    sessions.command('studio', { action: 'snapshot', sessionId: 'studio' }, () => {}),
  ).toThrow('disabled')
})
