export const gpuiBuildTargets = [
  { runner: 'ubuntu-24.04', os: 'linux', arch: 'x64', rust_host: 'x86_64-unknown-linux-gnu' },
  {
    runner: 'ubuntu-24.04-arm',
    os: 'linux',
    arch: 'arm64',
    rust_host: 'aarch64-unknown-linux-gnu',
  },
  { runner: 'macos-26-intel', os: 'macos', arch: 'x64', rust_host: 'x86_64-apple-darwin' },
  { runner: 'macos-26', os: 'macos', arch: 'arm64', rust_host: 'aarch64-apple-darwin' },
  { runner: 'windows-2025', os: 'windows', arch: 'x64', rust_host: 'x86_64-pc-windows-msvc' },
  { runner: 'windows-11-arm', os: 'windows', arch: 'arm64', rust_host: 'aarch64-pc-windows-msvc' },
]

export function gpuiTargets(platforms = 'all') {
  if (!['all', 'windows-macos', 'linux'].includes(platforms))
    throw new Error('Invalid GPUI platform selection')
  return gpuiBuildTargets.filter(
    ({ os }) => platforms === 'all' || (platforms === 'linux' ? os === 'linux' : os !== 'linux'),
  )
}
