import { expect, it, vi } from 'vite-plus/test'
import { decode, questionPromptSchema, type QuestionSecretReferences } from '@dovo/protocol'
import type { Activity } from '../../storage/activity'
import { Questions } from './questions'
import { SecretReferences } from '../configuration/secret-references'

const prompt = decode(questionPromptSchema, {
  title: 'Credentials',
  questions: [
    { id: 'key', header: 'API key', question: 'Provide the API key', secret: true },
    { id: 'normal', header: 'Name', question: 'Name', required: false },
  ],
})
function setup() {
  const add = vi.fn<Activity['add']>()
  const questions = new Questions({ add })
  const resolver = new SecretReferences(() => ({ FIXTURE_KEY: 'host-private-value' }))
  questions.setSecretReferences(resolver)
  const controller = new AbortController()
  const result = questions.request('task', prompt, controller.signal)
  const id = questions.list()[0].id
  return { questions, resolver, add, controller, result, id }
}
const references: QuestionSecretReferences = {
  key: { provider: 'environment', reference: 'FIXTURE_KEY' },
}
it('resolves host references, redacts activity, and accepts a receipt retry without reading twice', async () => {
  const s = setup()
  const read = vi.spyOn(s.resolver, 'value')
  expect(s.questions.list()[0].secretReferences).toBe(true)
  await s.questions.respondWithAttachments(s.id, {}, {}, undefined, references)
  expect(await s.result).toEqual({ key: ['host-private-value'] })
  expect(JSON.stringify(s.add.mock.calls)).not.toContain('host-private-value')
  expect(JSON.stringify(s.add.mock.calls)).not.toContain('FIXTURE_KEY')
  expect(JSON.stringify(s.add.mock.calls)).toContain('[redacted]')
  await s.questions.respondWithAttachments(s.id, {}, {}, undefined, references)
  expect(read).toHaveBeenCalledTimes(1)
  await expect(
    s.questions.respondWithAttachments(s.id, {}, {}, undefined, {
      key: { provider: 'environment', reference: 'OTHER_KEY' },
    }),
  ).rejects.toThrow('differently')
  await s.resolver.close()
})
it('rejects non-secret, unknown, duplicate and declined reference answers before reading', async () => {
  const s = setup()
  const read = vi.spyOn(s.resolver, 'value')
  for (const target of ['normal', 'unknown'])
    await expect(
      s.questions.respondWithAttachments(s.id, {}, {}, undefined, { [target]: references.key }),
    ).rejects.toThrow('only answer secret')
  await expect(
    s.questions.respondWithAttachments(s.id, { key: ['typed'] }, {}, undefined, references),
  ).rejects.toThrow('typed answer or')
  await expect(
    s.questions.respondWithAttachments(s.id, null, {}, undefined, references),
  ).rejects.toThrow('Declined')
  expect(read).not.toHaveBeenCalled()
  s.controller.abort()
  await s.result
  await s.resolver.close()
})
it('keeps a failed vault lookup pending and rereads only that reference on retry', async () => {
  const s = setup()
  const read = vi.spyOn(s.resolver, 'value').mockRejectedValueOnce(new Error('Unlock the vault'))
  await expect(
    s.questions.respondWithAttachments(s.id, {}, {}, undefined, references),
  ).rejects.toThrow('Unlock')
  expect(s.questions.status(s.id)).toBe('pending')
  await s.questions.respondWithAttachments(s.id, {}, {}, undefined, references)
  expect(await s.result).toEqual({ key: ['host-private-value'] })
  expect(read).toHaveBeenCalledTimes(2)
  await s.resolver.close()
})
it('coalesces concurrent replies and discards a secret resolved after cancellation', async () => {
  const s = setup()
  let finish: (value: string) => void = () => {}
  const read = vi.spyOn(s.resolver, 'value').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const first = s.questions.respondWithAttachments(s.id, {}, {}, undefined, references)
  const second = s.questions.respondWithAttachments(s.id, {}, {}, undefined, references)
  const results = Promise.allSettled([first, second])
  s.controller.abort()
  finish('late-secret')
  expect(await s.result).toBeNull()
  expect((await results).every((result) => result.status === 'rejected')).toBe(true)
  expect(read).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(s.add.mock.calls)).not.toContain('late-secret')
  await s.resolver.close()
})
