import { expect, it } from 'vite-plus/test'
import { formatBrowserJson, highlightBrowserJson } from './browser-json'
import { studioSyntaxTheme } from './themes'
import { highlightFilteredBrowserJson } from './browser-json-format'

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

it('highlights filtered source without changing values or allowing server markup', () => {
  const source = '{"id":900719925474099312345,"x":"<script>&\\u0061","ok":true,"nil":null}'
  const html = highlightFilteredBrowserJson(source)
  expect(html).toContain('class="dovo-json-property"')
  expect(html).toContain('class="dovo-json-string"')
  expect(html).toContain('class="dovo-json-number">900719925474099312345</span>')
  expect(html).toContain('class="dovo-json-boolean">true</span>')
  expect(html).toContain('class="dovo-json-constant">null</span>')
  expect(html).toContain('&lt;script&gt;&amp;')
  expect(html).not.toContain('<script>')
  expect(
    html
      .replace(/<[^>]*>/g, '')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&'),
  ).toBe(source)
})
