import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Terminals } from './terminals.js'

const pty = vi.hoisted(() => ({
  data: undefined as ((data: string) => void) | undefined,
  exit: undefined as ((event: { exitCode: number }) => void) | undefined,
  write: vi.fn<(data: string) => void>(),
  resize: vi.fn<(cols: number, rows: number) => void>(),
}))
vi.mock('node:module', () => ({
  createRequire: () => () => ({
    spawn: () => ({
      onData: (listener: (data: string) => void) => {
        pty.data = listener
      },
      onExit: (listener: (event: { exitCode: number }) => void) => {
        pty.exit = listener
      },
      write: pty.write,
      resize: pty.resize,
    }),
  }),
}))
afterEach(() => vi.clearAllMocks())

function terminal() {
  const terminals = new Terminals()
  const info = terminals.createCommand(
    'task',
    process.cwd(),
    { command: 'fake', args: [], env: {} },
    'Test',
  )
  return { terminals, id: info.id }
}
it('preserves the exact UTF-16 suffix through small writes, rollover, oversized chunks and replay', async () => {
  const { terminals, id } = terminal()
  const cap = 1024 * 1024
  const writes: string[] = []
  const expected = () => writes.join('').slice(-cap)
  const append = (data: string) => {
    writes.push(data)
    pty.data!(data)
  }
  try {
    expect(terminals.get(id).buffer).toBe('')
    append('🙂\u001b[31mfirst\r\n')
    append('🙂' + 'a'.repeat(cap - 1))
    // The cap deliberately retains a lone low surrogate, as the previous slice did.
    expect(terminals.get(id).buffer).toBe(expected())
    expect(terminals.get(id).buffer.charCodeAt(0)).toBe(0xde42)
    for (let i = 0; i < 3000; i++) append(`${i}:🙂\r\n`.repeat(80))
    for (let i = 0; i < 5000; i++) append(i % 2 ? '\ud83d' : '\ude42')
    append('')
    expect(terminals.get(id).buffer).toBe(expected())
    const replay = vi.fn<(data: string) => void>()
    const detach = terminals.attach(id, replay)
    expect(replay).toHaveBeenCalledExactlyOnceWith(expected())
    append('tail')
    expect(replay).toHaveBeenLastCalledWith('tail')
    detach()
    append('unobserved')
    expect(replay).toHaveBeenCalledTimes(2)
    append('oversized🙂'.repeat(cap))
    expect(terminals.get(id).buffer).toBe(expected())
    const reattach = vi.fn<(data: string) => void>()
    terminals.attach(id, reattach)
    expect(reattach).toHaveBeenCalledExactlyOnceWith(expected())
  } finally {
    pty.exit!({ exitCode: 0 })
    await terminals.dispose()
  }
})
it('keeps live delivery synchronous and ordered and isolates failing clients', async () => {
  const { terminals, id } = terminal()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const seen: string[] = []
  try {
    terminals.attach(id, (data) => {
      if (data) throw new Error('Disconnected')
    })
    terminals.attach(id, (data) => seen.push(data))
    pty.data!('one')
    expect(seen).toEqual(['', 'one'])
    pty.data!('two')
    expect(seen).toEqual(['', 'one', 'two'])
    expect(errors).toHaveBeenCalledTimes(2)
    terminals.input(id, 'input')
    terminals.resize(id, 80, 30)
    expect(pty.write).toHaveBeenCalledExactlyOnceWith('input')
    expect(pty.resize).toHaveBeenCalledExactlyOnceWith(80, 30)
    pty.exit!({ exitCode: 7 })
    expect(seen.at(-1)).toBe('\r\n[Process exited 7]\r\n')
    expect(terminals.get(id).buffer).toBe('onetwo')
    await terminals.dispose()
  } finally {
    errors.mockRestore()
  }
})
