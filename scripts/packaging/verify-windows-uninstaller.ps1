param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
if (-not $env:AZURE_SIGNING_PUBLISHER) { throw 'Missing AZURE_SIGNING_PUBLISHER' }
$file = Get-Item -LiteralPath $Path
$signTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signTool) { throw 'Windows SDK SignTool is missing' }
# Require the embedded Authenticode signature, rather than a Windows catalog signature.
& $signTool.FullName verify /pa /v $file.FullName
if ($LASTEXITCODE -ne 0) { throw "Invalid embedded uninstaller signature: $($file.FullName)" }
$signedCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($file.FullName)
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($signedCertificate)
try {
  $publisher = $certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($publisher -cne $env:AZURE_SIGNING_PUBLISHER) { throw "Unexpected uninstaller publisher: $publisher" }
} finally {
  $certificate.Dispose()
  $signedCertificate.Dispose()
}
