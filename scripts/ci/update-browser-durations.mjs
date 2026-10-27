import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function updateDurations(previous, reports) {
  const samples = new Map()
  for (const report of reports)
    for (const suite of report.suites) {
      if (suite.status !== 'success') continue
      if (
        !/^test:.+:browser$/.test(suite.name) ||
        !Number.isFinite(suite.seconds) ||
        suite.seconds <= 0
      )
        throw new Error('Invalid successful browser timing')
      const values = samples.get(suite.name) ?? []
      values.push(suite.seconds)
      samples.set(suite.name, values)
    }
  const seconds = { ...previous }
  for (const [name, values] of samples) {
    values.sort((a, b) => a - b)
    seconds[name] = values[Math.floor(values.length / 2)]
  }
  return Object.fromEntries(Object.entries(seconds).sort(([a], [b]) => a.localeCompare(b)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2)
  if (!files.length)
    throw new Error('Usage: node scripts/ci/update-browser-durations.mjs <browser-timings.json>...')
  const target = new URL('./browser-durations.json', import.meta.url)
  const previous = JSON.parse(readFileSync(target, 'utf8'))
  const reports = files.map((path) => JSON.parse(readFileSync(path, 'utf8')))
  writeFileSync(
    target,
    JSON.stringify(
      {
        source: 'Measured browser-timings artifacts',
        seconds: updateDurations(previous.seconds, reports),
      },
      null,
      2,
    ) + '\n',
  )
}
