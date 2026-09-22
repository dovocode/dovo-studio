import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export async function desktopMiseArchive(root) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const temporary = await mkdtemp(join(tmpdir(), 'dovo-desktop-mise-'))
  try {
    await mkdir(join(temporary, 'bin'))
    await writeFile(
      join(temporary, 'bin/dovo-studio'),
      `#!/bin/sh
set -eu
entry="$0"
while [ -L "$entry" ]; do
  parent=$(CDPATH= cd -- "$(dirname -- "$entry")" && pwd)
  entry=$(readlink "$entry")
  case "$entry" in /*) ;; *) entry="$parent/$entry" ;; esac
done
base=$(CDPATH= cd -- "$(dirname -- "$entry")/.." && pwd)
exec /usr/bin/open -a "$base/Dovo Studio.app" --args "$@"
`,
      { mode: 0o755 },
    )
    const artifact = join(root, 'release', `Dovo-Studio-mise-${version}-macos-arm64.tar.gz`)
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
        'Dovo Studio.app',
      ],
      { stdio: 'inherit' },
    )
    return artifact
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
