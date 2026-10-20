import { expect, it } from 'vite-plus/test'
import { approvalDetails } from './approval-details.js'

it('puts the reason and exact command before metadata and preserves the full payload', () => {
  const input = {
    threadId: 'thread',
    turnId: 'turn',
    itemId: 'item',
    cwd: '/work/my app',
    command: 'git status && echo "$HOME"',
    reason: 'Inspect the working tree',
    additionalPermissions: { fileSystem: { write: ['/tmp/output'] } },
  }
  const result = approvalDetails(JSON.stringify(input))
  expect(result.fields.map((field) => field.label)).toEqual([
    'Reason',
    'Command',
    'Working folder',
    'Additional permissions',
  ])
  expect(result.fields[1]).toEqual({ label: 'Command', text: input.command, code: true })
  expect(result.fields[3].children?.[0].label).toBe('File access')
  expect(JSON.parse(result.raw)).toEqual(input)
})

it('keeps unknown fields, arrays, false values, zeroes and nulls visible', () => {
  const result = approvalDetails(
    '{"unfamiliar_option":{"enabled":false,"count":0,"mode":null,"paths":["/one","/two"]}}',
  )
  expect(result.fields[0].label).toBe('Unfamiliar option')
  expect(result.fields[0].children?.slice(0, 3).map((field) => field.text)).toEqual([
    'No',
    '0',
    'Not set',
  ])
  expect(result.fields[0].children?.[3].text).toBe('/one\n/two')
})

it('keeps plain text and malformed JSON readable without losing characters', () => {
  for (const detail of [
    'Search the documentation\nhttps://example.com',
    '{"command":',
    '<img src=x onerror=alert(1)>',
  ])
    expect(approvalDetails(detail)).toEqual({
      fields: [{ label: '', text: detail }],
      raw: detail,
      json: false,
    })
})

it('bounds large and deeply nested presentations without dropping the original data', () => {
  const input = Object.fromEntries(
    Array.from({ length: 1000 }, (_, index) => ['field' + index, index]),
  )
  const result = approvalDetails(JSON.stringify(input))
  expect(result.fields.length).toBeLessThanOrEqual(121)
  expect(result.fields.at(-1)?.text).toContain('Full JSON')
  expect(JSON.parse(result.raw)).toEqual(input)
  const deep = '{"nested":'.repeat(100) + 'true' + '}'.repeat(100)
  expect(approvalDetails(deep).json).toBe(true)
  expect(approvalDetails('[]').json).toBe(true)
  expect(approvalDetails('false').fields[0].text).toBe('No')
})

it('treats prototype-like JSON keys as ordinary provider fields', () => {
  const detail = '{"constructor":"tool","__proto__":{"write":true}}'
  const result = approvalDetails(detail)
  expect(result.fields[0].label).toBe('Constructor')
  expect(result.fields[1].children?.[0]).toEqual({ label: 'Write', text: 'Yes', code: false })
  expect(JSON.parse(result.raw)).toEqual(JSON.parse(detail))
})
