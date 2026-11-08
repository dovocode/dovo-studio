import { expect, it } from 'vite-plus/test'
import { previewPatch } from './preview-patch.js'

it('generates a patch without blocking the runtime event loop', async () => {
  let ticks = 0
  const timer = setInterval(() => ticks++, 5)
  try {
    const patch = await previewPatch('file.txt', 'before\n', 'after\n')
    expect(patch).toContain('-before')
    expect(patch).toContain('+after')
    expect(ticks).toBeGreaterThan(0)
  } finally {
    clearInterval(timer)
  }
})

it('bounds concurrent work and keeps complete text as a fallback', async () => {
  const before = Array.from({ length: 10000 }, (_, index) => `before ${index}\n`).join('')
  const after = Array.from({ length: 10000 }, (_, index) => `after ${index}\n`).join('')
  const first = previewPatch('a', before, after)
  const second = previewPatch('b', before, after)
  expect(await previewPatch('c', before, after)).toBeUndefined()
  await Promise.all([first, second])
})

it('runs when the parent was launched with module input mode', async () => {
  process.execArgv.push('--input-type=module')
  try {
    expect(await previewPatch('file.txt', 'old\n', 'new\n')).toContain('+new')
  } finally {
    process.execArgv.pop()
  }
})
