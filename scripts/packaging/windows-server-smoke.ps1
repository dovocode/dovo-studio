param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$Directory
)
$ErrorActionPreference = 'Stop'
$destination = Join-Path $Directory 'Dovo Server Extracted'
Expand-Archive -LiteralPath $Archive -DestinationPath $destination
$name = if ($env:DOVO_RELEASE_CHANNEL -eq 'nightly') { 'dovo-server-nightly.cmd' } else { 'dovo-server.cmd' }
$launcher = Join-Path $destination "bin/$name"
$data = Join-Path $Directory 'Dovo Server Smoke Data'
& $launcher --help
if ($LASTEXITCODE -ne 0) { throw 'Extracted launcher failed' }
& $launcher setup --data-dir $data --host 127.0.0.1 --port 51465
if ($LASTEXITCODE -ne 0) { throw 'Server setup failed' }
try {
  & $launcher start --data-dir $data
  if ($LASTEXITCODE -ne 0) { throw 'Server start failed' }
  $status = & $launcher status --data-dir $data --json | ConvertFrom-Json
  if (!$status.running -or !$status.managed) { throw 'Server is not healthy and managed' }
} finally {
  & $launcher stop --data-dir $data
  if ($LASTEXITCODE -ne 0) { throw 'Server stop failed' }
}
