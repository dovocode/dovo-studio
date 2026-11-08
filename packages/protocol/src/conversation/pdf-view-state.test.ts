import { expect, it } from 'vite-plus/test'
import { parsePdfViewerMessage, parsePdfViewState } from './pdf-view-state'

it('accepts only bounded PDF state and the current bridge identity', () => {
  const state = { page: 2, zoom: 1.25, scrollTop: 200, scrollLeft: 0 }
  expect(
    parsePdfViewerMessage({ channel: 'dovo-pdf', id: 'current', type: 'state', state }, 'current'),
  ).toEqual({ channel: 'dovo-pdf', id: 'current', type: 'state', state })
  expect(
    parsePdfViewerMessage({ channel: 'dovo-pdf', id: 'old', type: 'state', state }, 'current'),
  ).toBeUndefined()
  for (const invalid of [
    { ...state, page: 0 },
    { ...state, page: 1.5 },
    { ...state, page: Infinity },
    { ...state, zoom: 3.1 },
    { ...state, zoom: NaN },
    { ...state, scrollTop: -1 },
    { ...state, scrollLeft: 10000001 },
    { ...state, scrollTop: '200' },
  ])
    expect(parsePdfViewState(invalid)).toBeUndefined()
  expect(parsePdfViewState({ ...state, token: 'ignored' })).toEqual(state)
})

it('rejects malformed messages and accepts inclusive numeric boundaries', () => {
  const state = { page: Number.MAX_SAFE_INTEGER, zoom: 0.5, scrollTop: 0, scrollLeft: 10000000 }
  expect(parsePdfViewState(state)).toEqual(state)
  expect(parsePdfViewState({ ...state, zoom: 3 })).toEqual({ ...state, zoom: 3 })
  for (const value of [
    null,
    undefined,
    [],
    'state',
    0,
    { ...state, page: Number.MAX_SAFE_INTEGER + 1 },
    { ...state, zoom: 0.49 },
    { ...state, scrollTop: Infinity },
  ])
    expect(parsePdfViewState(value)).toBeUndefined()
  expect(parsePdfViewerMessage({ channel: 'dovo-pdf', id: 'id', type: 'ready' }, 'id')).toEqual({
    channel: 'dovo-pdf',
    id: 'id',
    type: 'ready',
  })
  for (const value of [
    null,
    'message',
    {},
    { channel: 'other', id: 'id', type: 'ready' },
    { channel: 'dovo-pdf', id: 'id', type: 'restore', state },
    { channel: 'dovo-pdf', id: 'id', type: 'state', state: null },
  ])
    expect(parsePdfViewerMessage(value, 'id')).toBeUndefined()
})
