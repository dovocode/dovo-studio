import assert from 'node:assert/strict'

export function terminateBrowserRenderers(
  processInfo,
  kill = (pid, signal) => process.kill(pid, signal),
) {
  // Chromium can report a renderer without a live process (PID 0). On Unix,
  // kill(0) signals our process group and negative PIDs can target other groups.
  const renderers = processInfo.filter(
    ({ type, id }) => type === 'renderer' && Number.isSafeInteger(id) && id > 1,
  )
  assert.ok(renderers.length, 'Chromium must have a live renderer to terminate')
  for (const { id } of renderers) {
    try {
      kill(id, 'SIGKILL')
    } catch (error) {
      // Spare renderers can exit between the process snapshot and fault injection.
      if (error.code !== 'ESRCH') throw error
    }
  }
}
