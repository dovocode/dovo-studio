import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'
import {
  decode,
  mutableStruct,
  windowsSecurityReportSchema,
  type WindowsSecurityReport,
} from '@dovo/protocol'

const execute = promisify(execFile)
// Fixed, read-only query. Do not include messages, users or command lines: they
// can contain credentials. XML field names are stable across Windows languages.
export const windowsSecurityScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $records = @(Get-WinEvent -FilterHashtable @{
    LogName = 'Microsoft-Windows-Windows Defender/Operational'
    Id = 1121
    StartTime = (Get-Date).AddHours(-2)
  } -MaxEvents 20 -ErrorAction Stop)
  $events = @($records | ForEach-Object {
    $xml = [xml]$_.ToXml()
    $fields = @{}
    foreach ($field in $xml.Event.EventData.Data) { $fields[$field.Name] = [string]$field.'#text' }
    [PSCustomObject]@{
      timeCreated = $_.TimeCreated.ToUniversalTime().ToString('o')
      ruleId = [string]$fields['ID']
      processPath = [string]$fields['Process Name']
      targetPath = [string]$fields['Path']
    }
  })
  @{ status = 'ok'; events = $events } | ConvertTo-Json -Depth 4 -Compress
} catch {
  $status = 'unavailable'
  if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { $status = 'ok' }
  elseif ($_.CategoryInfo.Category -eq 'PermissionDenied' -or $_.Exception -is [System.UnauthorizedAccessException] -or $_.Exception -is [System.Security.SecurityException]) { $status = 'access-denied' }
  @{ status = $status; events = @() } | ConvertTo-Json -Depth 4 -Compress
}
`
const resultSchema = mutableStruct({
  status: windowsSecurityReportSchema.fields.status,
  events: windowsSecurityReportSchema.fields.events,
})
// Keep the schema at the process boundary as well as the renderer boundary.
export function parseWindowsSecurityResult(
  stdout: string,
): Pick<WindowsSecurityReport, 'status' | 'events'> {
  return decode(resultSchema, JSON.parse(stdout.replace(/^\uFEFF/, '').trim()))
}
export async function readWindowsSecurity(): Promise<WindowsSecurityReport> {
  if (process.platform !== 'win32') throw new Error('Windows security checks require Windows')
  const checkedAt = new Date().toISOString()
  try {
    const { stdout } = await execute(
      win32.join(
        process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsSecurityScript],
      { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
    )
    return { checkedAt, ...parseWindowsSecurityResult(stdout) }
  } catch {
    // Launch failure, policy block, timeout and malformed output are not a clean
    // event log. Preserve that distinction without exposing process stderr.
    return { checkedAt, status: 'unavailable', events: [] }
  }
}
