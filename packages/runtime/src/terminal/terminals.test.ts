import { expect, it, vi } from 'vitest'
import { Terminals } from './terminals'
import { fixture } from '../testing/fixture'
it('runs a real PTY and retains output when clients detach', async () => {
  const f = await fixture(),
    terminals = new Terminals()
  try {
    const session = terminals.create('task', f.directory)
    const result = new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('PTY did not produce expected output')), 5000)
      const detach = terminals.attach(session.id, (data) => {
        output += data
        if (output.includes('dovo-pty-verified')) {
          clearTimeout(timer)
          detach()
          resolve(output)
        }
      })
      terminals.input(session.id, "printf 'dovo-pty-%s\\n' verified\r")
    })
    expect(await result).toContain('dovo-pty-verified')
    let replay = ''
    const detach = terminals.attach(session.id, (data) => {
      replay += data
    })
    expect(replay).toContain('dovo-pty-verified')
    detach()
    terminals.resize(session.id, 80, 30)
    terminals.close(session.id)
    expect(terminals.list()).toEqual([])
  } finally {
    terminals.dispose()
    await f.cleanup()
  }
})
it('keeps delivering terminal output when one client throws', async () => {
  const f = await fixture(),
    terminals = new Terminals()
  const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const session = terminals.create('task', f.directory)
    let armed = false
    terminals.attach(session.id, (data) => {
      if (armed && data) throw new Error('closed client')
    })
    armed = true
    const result = new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('PTY did not produce expected output')), 5000)
      terminals.attach(session.id, (data) => {
        output += data
        if (output.includes('dovo-pty-verified')) {
          clearTimeout(timer)
          resolve(output)
        }
      })
      terminals.input(session.id, "printf 'dovo-pty-%s\\n' verified\r")
    })
    expect(await result).toContain('dovo-pty-verified')
    expect(reported).toHaveBeenCalled()
    terminals.close(session.id)
  } finally {
    reported.mockRestore()
    terminals.dispose()
    await f.cleanup()
  }
})
