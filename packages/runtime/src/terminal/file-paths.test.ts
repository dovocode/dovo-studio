import { expect, it } from 'vite-plus/test'
import { quoteTerminalPaths } from './file-paths'

it('PowerShell quotes apostrophes and expansion syntax literally', () => {
  expect(quoteTerminalPaths(["C:\\it's\\$file.txt"], 'C:\\Windows\\powershell.exe')).toBe(
    "'C:\\it''s\\$file.txt' ",
  )
  expect(quoteTerminalPaths(['$(Get-Process)'], '/usr/bin/pwsh')).toBe("'$(Get-Process)' ")
})

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
