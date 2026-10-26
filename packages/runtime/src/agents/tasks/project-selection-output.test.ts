import { expect, it } from 'vite-plus/test'
import { parseProjectSelection } from './project-selection-output'

const selection = {
  status: 'selected',
  repositoryId: 'shop',
  links: [{ repositoryId: 'api', access: 'read-only' }],
  reason: 'src/cart.ts calls the API; braces such as {total} are evidence.',
}
const json = JSON.stringify(selection)

it.each([
  json,
  `\n${json}\n`,
  `\`\`\`json\n${json}\n\`\`\``,
  `\`\`\`JSON ${json}\`\`\``,
  `I inspected the shopping code.\n\`\`\`json\r\n${json}\r\n\`\`\`\nThis is the owner.`,
])('reads one complete selection with optional presentation: %s', (output) => {
  expect(parseProjectSelection(output)).toEqual(selection)
})

it.each([
  '',
  'No matching project',
  json.slice(0, -1),
  `${json}\n${json}`,
  JSON.stringify([selection]),
  JSON.stringify({ ...selection, repositoryId: 1 }),
  JSON.stringify({ ...selection, links: [{ repositoryId: 'api', access: 'write' }] }),
  JSON.stringify({
    ...selection,
    links: Array.from({ length: 13 }, (_, i) => ({ repositoryId: `p${i}`, access: 'edit' })),
  }),
])('rejects incomplete, conflicting or invalid responses: %s', (output) => {
  expect(() => parseProjectSelection(output)).toThrow(/.+/)
})
