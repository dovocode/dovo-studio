import { expect, it } from 'vite-plus/test'
import { routineQuietNow, parseRoutineOptions, routineOptionFields } from './routine-policy'
it('handles overnight quiet hours and DST in the saved time zone', () => {
  const quiet = { start: '22:00', end: '07:00', timezone: 'Europe/Amsterdam' }
  expect(routineQuietNow(quiet, Date.parse('2026-11-13T22:00:00Z'))).toBe(true)
  expect(routineQuietNow(quiet, Date.parse('2026-11-14T06:00:00Z'))).toBe(false)
  expect(routineQuietNow(quiet, Date.parse('2026-07-14T05:00:00Z'))).toBe(false)
  expect(routineQuietNow({ ...quiet, start: '07:00' }, Date.now())).toBe(false)
})
it('keeps HTTP sources and validates optional budgets and quiet-hour fields consistently', () => {
  const fields = routineOptionFields({})
  expect(
    parseRoutineOptions({
      ...fields,
      url: 'http://lan-host/source',
      costUsd: '0.25',
      minutes: '5',
    }),
  ).toMatchObject({
    monitor: { url: 'http://lan-host/source' },
    policy: { costUsd: 0.25, minutes: 5 },
  })
  for (const invalid of [
    { tokens: '1.5' },
    { minutes: '0' },
    { costUsd: 'abc' },
    { url: 'ftp://host' },
    { start: '22:00' },
    { start: '22:00', end: '07:00', timezone: 'Invalid/Zone' },
  ])
    expect(() => parseRoutineOptions({ ...fields, ...invalid })).toThrow(Error)
})
it('validates and preserves optional JSON pointers on both clients', () => {
  const fields = routineOptionFields({
    monitor: { url: 'http://lan/source', jsonPointer: '/a~1b/0' },
  })
  expect(parseRoutineOptions(fields).monitor).toEqual({
    url: 'http://lan/source',
    jsonPointer: '/a~1b/0',
  })
  for (const jsonPointer of ['release', '/bad~', '/bad~2'])
    expect(() => parseRoutineOptions({ ...fields, jsonPointer })).toThrow(Error)
  expect(() => parseRoutineOptions({ ...fields, url: '' })).toThrow(Error)
})
it('configures a versioned MCP text resource without permitting tools or mixed sources', () => {
  const fields = routineOptionFields({})
  const configured = {
    ...fields,
    mcpServer: 'calendar',
    mcpUri: 'calendar://events',
    jsonPointer: '/version',
  }
  expect(parseRoutineOptions(configured).monitor).toEqual({
    url: '',
    mcp: { server: 'calendar', uri: 'calendar://events' },
    jsonPointer: '/version',
  })
  expect(() => parseRoutineOptions({ ...configured, url: 'http://host/source' })).toThrow('one')
  expect(() => parseRoutineOptions({ ...configured, mcpUri: '' })).toThrow(Error)
})
