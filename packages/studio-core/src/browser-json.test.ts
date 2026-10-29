import { expect, it } from 'vite-plus/test'
import { formatBrowserJson, highlightBrowserJson } from './browser-json'
import { studioSyntaxTheme } from './themes'

it('formats JSON without rounding numbers, changing escapes or dropping duplicate keys', () => {
  const source = '{"id":900719925474099312345,"n":1.2300e+9,"x":"\\u0061","x":null,"empty":[]}'
  const formatted = formatBrowserJson(source)
  expect(formatted).toContain('\n  "id": 900719925474099312345,')
  expect(formatted).toContain('1.2300e+9')
  expect(formatted).toContain('"x": "\\u0061"')
  expect(formatted).toContain('"x": null')
  expect(formatBrowserJson(formatted)).toBe(formatted)
  expect(() => formatBrowserJson('{"broken":}')).toThrow(SyntaxError)
})

it('uses Studio syntax colors and escapes server-supplied markup', () => {
  const text = formatBrowserJson('{"html":"<script>alert(1)</script>","ok":true}')
  const highlighted = highlightBrowserJson(text, studioSyntaxTheme('dovo', 'dark'))
  expect(highlighted.css).toContain('color:#')
  expect(highlighted.html).toContain('class="dovo-json-token-')
  expect(highlighted.html).not.toContain('<script>')
  expect(highlighted.html).toContain('&lt;script&gt;')
})
