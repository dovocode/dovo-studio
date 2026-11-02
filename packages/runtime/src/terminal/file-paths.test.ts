import { expect, it } from 'vite-plus/test'
import { execFileSync } from 'node:child_process'
import { defaultShell } from './shell'
import { quoteTerminalPaths } from './file-paths'

const paths = [
  '/tmp/with spaces.txt',
  "/tmp/it's a file.txt",
  '/tmp/$(echo injected);`echo nope`&file',
  '/tmp/日本語🙂.txt',
  'C:\\Users\\Dominic\\file name.txt',
]

it.skipIf(process.platform === 'win32')(
  'POSIX shells receive dropped paths as literal arguments',
  () => {
    const text = quoteTerminalPaths(paths, '/bin/bash')
    const result = execFileSync('/bin/bash', ['-c', `printf '%s\\0' ${text}`], { encoding: 'utf8' })
    expect(result.split('\0').slice(0, -1)).toEqual(paths)
    expect(text.endsWith(' ')).toBe(true)
    expect(text).not.toContain('\n')
  },
)

it('PowerShell quotes apostrophes and expansion syntax literally', () => {
  expect(quoteTerminalPaths(["C:\\it's\\$file.txt"], 'C:\\Windows\\powershell.exe')).toBe(
    "'C:\\it''s\\$file.txt' ",
  )
  expect(quoteTerminalPaths(['$(Get-Process)'], '/usr/bin/pwsh')).toBe("'$(Get-Process)' ")
})

it.skipIf(process.platform !== 'win32')(
  'native PowerShell receives dropped paths as literal arguments',
  () => {
    const text = quoteTerminalPaths(paths, defaultShell())
    const result = execFileSync(
      defaultShell(),
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ConvertTo-Json -InputObject @(Write-Output ${text}) -Compress`,
      ],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(result)).toEqual(paths)
  },
)

it('CMD quotes spaces and rejects names that would expand variables or break quoting', () => {
  expect(quoteTerminalPaths(['C:\\file name.txt', 'C:\\another.txt'], 'cmd.exe')).toBe(
    '"C:\\file name.txt" "C:\\another.txt" ',
  )
  for (const path of ['C:\\%PATH%', 'C:\\!USER!', 'C:\\a"b'])
    expect(() => quoteTerminalPaths([path], 'cmd.exe')).toThrow('CMD cannot safely paste')
})

it('rejects control characters before they can submit input or introduce terminal escapes', () => {
  for (const path of ['', '/tmp/line\nbreak', '/tmp/\r', '/tmp/\x1b[0m', '/tmp/\0', '/tmp/\t'])
    expect(() => quoteTerminalPaths([path], '/bin/bash')).toThrow('control characters')
})
