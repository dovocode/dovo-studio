import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  githubEventChoices,
  automationScheduleChoices,
} from '../packages/protocol/dist/automation/triggers.js'
import { remoteBrowserHtml } from '../packages/protocol/dist/generated/browser-viewer.js'
import { harnessIconData } from '../packages/protocol/dist/tasks/harness-icon-data.js'

await import('./build-mcp-apps.mjs')

const directory = new URL('../apps/desktop-gpui/assets/', import.meta.url)
await mkdir(directory, { recursive: true })
const harnessIcons = Object.fromEntries(
  Object.entries(harnessIconData).map(([provider, icon]) => [
    `harness/${provider}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" fill="currentColor">${icon.paths.map((path) => `<path d="${path.d}"${path.opacity === undefined ? '' : ` opacity="${path.opacity}"`}/>`).join('')}</svg>`,
  ]),
)
await writeFile(new URL('harness-icons.json', directory), JSON.stringify(harnessIcons))
await writeFile(new URL('browser-viewer.html', directory), remoteBrowserHtml)

const host = JSON.parse(
  await readFile(new URL('../packages/studio-ui/mcp-apps/host.json', import.meta.url), 'utf8'),
)
await writeFile(
  new URL('mcp-host.html', directory),
  host.replace('<html>', '<html data-sandbox-direct>'),
)

await writeFile(
  new URL('automation-choices.json', directory),
  JSON.stringify({ githubEventChoices, automationScheduleChoices }),
)
