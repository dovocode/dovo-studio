import { expect, it } from 'vite-plus/test'
import { createBrowserJsonFilter } from './browser-json-filter'

const source =
  '{"items":[{"id":900719925474099312345,"active":true,"label":"\\u0061"},{"id":2,"active":false}],"odd.key":{"/name":"<script>"}}'
it('selects nested data, wildcards, recursive keys and RFC filter expressions', () => {
  const filter = createBrowserJsonFilter(source)
  expect(filter('$.items[0].id').source).toBe('900719925474099312345')
  expect(filter('$.items[*].id')).toMatchObject({ source: '[900719925474099312345,2]', count: 2 })
  expect(filter('$..id').count).toBe(2)
  expect(filter('$.items[?(@.active == true)].label').source).toBe('"\\u0061"')
  expect(filter('$["odd.key"]["/name"]').source).toBe('"<script>"')
  expect(filter('$.items[-1].id').source).toBe('2')
})
it('restores the exact response and distinguishes empty matches from matched null', () => {
  const filter = createBrowserJsonFilter('{"value":null,"duplicate":1,"duplicate":2}')
  expect(filter('$.value')).toMatchObject({ source: 'null', count: 1 })
  expect(filter('$.missing')).toMatchObject({ source: '[]', count: 0 })
  expect(filter('$.duplicate').source).toBe('2')
  expect(filter(' ').source).toBe('{"value":null,"duplicate":1,"duplicate":2}')
  expect(filter('$').source).toBe(filter('').source)
  expect(() => filter('$.items[')).toThrow(/Expected/)
  expect(() => filter('$[?((()=>1)())]')).toThrow(/Expected/)
})
