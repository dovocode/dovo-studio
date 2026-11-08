import { expect, it } from 'vite-plus/test'
import { createDraftCreation, transferSharedDraft } from './draft-creation'

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

it('does not upload shared files if the destination changes while draft creation is pending', async () => {
  let finish!: () => void
  const creating = new Promise<void>((resolve) => {
    finish = resolve
  })
  const owner = new AbortController()
  let uploads = 0
  const transfer = transferSharedDraft({
    create: () => creating,
    upload: async () => {
      uploads++
    },
    files: ['screenshot'],
    signal: owner.signal,
  })
  owner.abort()
  finish()
  await expect(transfer).rejects.toThrow('destination changed')
  expect(uploads).toBe(0)
})

it('uses the captured uploader after creation and requires every shared file to be committed', async () => {
  let finish!: () => void
  const creating = new Promise<void>((resolve) => {
    finish = resolve
  })
  const uploads: string[] = []
  const selected = {
    upload: async (_files: string[], _signal: AbortSignal, committed: boolean) => {
      uploads.push(`original:${committed}`)
    },
  }
  const transfer = transferSharedDraft({
    create: () => creating,
    upload: selected.upload,
    files: ['screenshot'],
    signal: new AbortController().signal,
  })
  selected.upload = async () => {
    uploads.push('other runtime')
  }
  finish()
  await transfer
  expect(uploads).toEqual(['original:true'])
})
