import { win32 } from 'node:path'
import { HttpError } from '../../errors.js'
import { exec, processEnvironment } from '../../process.js'

const unchanged = 'The file was not changed. Your draft is still in the editor.'
const commandOptions = { timeout: 10_000, maxBuffer: 1024 * 1024 }

async function macMetadataMatches(temporary: string, path: string) {
  const [mode, attributes, flags] = await Promise.all([
    exec('/bin/ls', ['-ldbn', path, temporary], commandOptions),
    exec('/usr/bin/xattr', ['-s', path, temporary], commandOptions),
    exec('/usr/bin/stat', ['-f', '%Uf', path, temporary], commandOptions),
  ])
  if (mode.stderr || attributes.stderr || flags.stderr)
    throw new Error('Could not read file metadata')

  // A + or @ after the macOS mode indicates an ACL or extended attributes. xattr also
  // detects failures to list attributes, while ls can omit that diagnostic.
  const modes = mode.stdout.trimEnd().split('\n')
  const fileFlags = flags.stdout.trimEnd().split('\n')
  return (
    modes.length === 2 &&
    modes.every((line) => /^-[rwxSsTt-]{9} /u.test(line)) &&
    !attributes.stdout &&
    fileFlags.length === 2 &&
    /^\d+$/u.test(fileFlags[0]) &&
    fileFlags[0] === fileFlags[1]
  )
}

const windowsMetadataScript = String.raw`
$ErrorActionPreference = 'Stop'
# Reading the audit ACL requires a privilege that ordinary runtime accounts lack.
$sections = [System.Security.AccessControl.AccessControlSections]'Owner, Group, Access'
$metadata = foreach ($path in @($env:DOVO_REPLACEMENT_TARGET, $env:DOVO_REPLACEMENT_TEMP)) {
    $streams = @(Get-Item -Force -LiteralPath $path -Stream '*')
    if ($streams.Count -ne 1 -or $streams[0].Stream -cne ':$DATA') {
        # Leave the pair incomplete so the final comparison reports a mismatch.
        break
    }
    $file = Get-Item -Force -LiteralPath $path
    # Archive changes on writes. Normal only applies when the other flags are clear.
    $attributes = [int]$file.Attributes -band (-bnot 160)
    $acl = Get-Acl -LiteralPath $path
    "$attributes $($acl.GetSecurityDescriptorSddlForm($sections))"
}
if ($metadata.Count -eq 2 -and $metadata[0] -ceq $metadata[1]) { 'same' }
else { 'different' }
`

async function windowsMetadataMatches(temporary: string, path: string) {
  const shell = win32.join(
    process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  )
  const encoded = Buffer.from(windowsMetadataScript, 'utf16le').toString('base64')
  const { stdout, stderr } = await exec(
    shell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    {
      ...commandOptions,
      env: processEnvironment({
        DOVO_REPLACEMENT_TARGET: path,
        DOVO_REPLACEMENT_TEMP: temporary,
      }),
    },
  )
  if (stderr || !['same', 'different'].includes(stdout.trim()))
    throw new Error('Could not read file metadata')
  return stdout.trim() === 'same'
}

/** Check metadata before the caller's final check for concurrent edits. */
export async function prepareFileReplacement(temporary: string, path: string, existing: boolean) {
  if (!existing) return
  const matches =
    process.platform === 'darwin'
      ? macMetadataMatches
      : process.platform === 'win32'
        ? windowsMetadataMatches
        : undefined
  if (!matches) return
  const preserved = await matches(temporary, path).catch(() => {
    throw new HttpError(409, `Studio could not verify this file's metadata. ${unchanged}`)
  })
  if (!preserved)
    throw new HttpError(
      409,
      `Studio cannot save this file without changing its file attributes or access controls. ${unchanged}`,
    )
}
