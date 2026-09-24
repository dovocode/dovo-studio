import { expect, it } from 'vite-plus/test'
import { createDraftCreation } from './draft-creation'

it('shares a pending draft request across workspace refreshes', async () => {
  const create = createDraftCreation()
  let calls = 0
  let finish!: () => void
  const action = () => {
    calls++
    return new Promise<void>((resolve) => {
      finish = resolve
    })
  }
  const first = create('runtime/task/repo/0', action)
  expect(create('runtime/task/repo/0', action)).toBe(first)
  await Promise.resolve()
  expect(calls).toBe(1)
  finish()
  await first
  expect(create('runtime/task/repo/0', action)).toBe(first)
  expect(calls).toBe(1)
})

it('does not auto-retry failures but allows an explicit retry or another scope', async () => {
  const create = createDraftCreation()
  let calls = 0
  const action = async () => {
    calls++
    if (calls === 1) throw new Error('Offline')
  }
  await expect(create('runtime/task/repo/0', action)).rejects.toThrow('Offline')
  await expect(create('runtime/task/repo/0', action)).rejects.toThrow('Offline')
  expect(calls).toBe(1)
  await create('runtime/task/repo/1', action)
  await create('other-runtime/task/repo/0', action)
  expect(calls).toBe(3)
})
