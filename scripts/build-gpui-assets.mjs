import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { githubEventChoices, automationScheduleChoices } from '../packages/protocol/dist/automation/triggers.js'
import { remoteBrowserHtml } from '../packages/protocol/dist/generated/browser-viewer.js'

await import('./build-mcp-apps.mjs')

const directory = new URL('../apps/desktop-gpui/assets/', import.meta.url)
await mkdir(directory, { recursive: true })
await writeFile(new URL('browser-viewer.html', directory), remoteBrowserHtml)

const host = JSON.parse(
  await readFile(new URL('../packages/studio-ui/mcp-apps/host.json', import.meta.url), 'utf8'),
)
await writeFile(
  new URL('mcp-host.html', directory),
  host.replace('<html>', '<html data-sandbox-direct>'),
)

await writeFile(new URL('automation-choices.json', directory), JSON.stringify({ githubEventChoices, automationScheduleChoices }))
