import { expect, it } from 'vite-plus/test'
import { matchBrowserText } from './browser-find'

it('matches literal punctuation, Unicode, case, and regex groups across document text', async () => {
  const literal = await matchBrowserText(['a.b aXb A.B'], {
    text: 'a.b',
    regex: false,
    matchCase: false,
  }).result
  expect(literal.matches).toEqual([
    [
      [0, 3],
      [8, 11],
    ],
  ])
  const regex = await matchBrowserText(['Order 123\nOrder 456', '😀 café CAFÉ'], {
    text: 'Order \\d+|café',
    regex: true,
    matchCase: false,
  }).result
  expect(regex.matches).toEqual([
    [
      [0, 9],
      [10, 19],
    ],
    [
      [3, 7],
      [8, 12],
    ],
  ])
  expect(
    (await matchBrowserText(['Aa'], { text: 'A', regex: false, matchCase: true }).result).matches,
  ).toEqual([[[0, 1]]])
})

it('reports invalid and expensive expressions, handles zero-width patterns, and bounds results', async () => {
  expect(
    (await matchBrowserText(['abc'], { text: '[', regex: true, matchCase: false }).result).error,
  ).toBeTruthy()
  expect(
    (await matchBrowserText(['😀abc'], { text: '(?:)', regex: true, matchCase: false }).result)
      .matches,
  ).toEqual([[]])
  const many = await matchBrowserText(['a'.repeat(20000)], {
    text: 'a',
    regex: true,
    matchCase: false,
  }).result
  expect(many.matches?.[0]).toHaveLength(10000)
  expect(many.limited).toBe(true)
  expect(
    (
      await matchBrowserText(['a'.repeat(100000) + '!'], {
        text: '(a+)+$',
        regex: true,
        matchCase: false,
      }).result
    ).error,
  ).toContain('took too long')
})
