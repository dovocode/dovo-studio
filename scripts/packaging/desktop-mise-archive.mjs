import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseVariant } from './release-variant.mjs'
export async function desktopMiseArchive(root) {
  const { version, productName, artifactPrefix, nightly } = await releaseVariant(root)
  const temporary = await mkdtemp(join(tmpdir(), 'dovo-desktop-mise-'))
  try {
    await mkdir(join(temporary, 'bin'))
    await writeFile(
      join(temporary, nightly ? 'bin/dovo-studio-nightly' : 'bin/dovo-studio'),
      `#!/bin/sh
set -eu
entry="$0"
while [ -L "$entry" ]; do
  parent=$(CDPATH= cd -- "$(dirname -- "$entry")" && pwd)
  entry=$(readlink "$entry")
  case "$entry" in /*) ;; *) entry="$parent/$entry" ;; esac
done
base=$(CDPATH= cd -- "$(dirname -- "$entry")/.." && pwd)
exec /usr/bin/open -a "$base/${productName}.app" --args "$@"
`,
      { mode: 0o755 },
    )
    const artifact = join(root, 'release', `${artifactPrefix}-mise-${version}-macos-arm64.tar.gz`)
    execFileSync(
      'tar',
      [
        '-czf',
        artifact,
        '-C',
        temporary,
        'bin',
        '-C',
        join(root, 'release/mac-arm64'),
        `${productName}.app`,
      ],
      { stdio: 'inherit' },
    )
    return artifact
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
