import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const assets = resolve(process.argv[2] ?? 'release')
const output = resolve(process.argv[3] ?? 'release/distribution')
const version =
  process.argv[4] ??
  JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error('Distribution requires a stable X.Y.Z version.')
const base = `https://github.com/dovocode/dovo-studio/releases/download/v${version}`
const names = [
  `Dovo-Server-${version}-macos-arm64.tar.gz`,
  `Dovo-Server-${version}-linux-arm64.tar.gz`,
  `Dovo-Server-${version}-linux-x64.tar.gz`,
  `Dovo-Studio-${version}-arm64.zip`,
  `Dovo-Studio-mise-${version}-macos-arm64.tar.gz`,
]
const hashes = new Map()
for (const name of names)
  hashes.set(
    name,
    createHash('sha256')
      .update(await readFile(join(assets, name)))
      .digest('hex'),
  )
const source = (name) => `url "${base}/${name}"\n      sha256 "${hashes.get(name)}"`
await mkdir(join(output, 'Formula'), { recursive: true })
await mkdir(join(output, 'Casks'), { recursive: true })
await writeFile(
  join(output, 'Formula/dovo-server.rb'),
  `class DovoServer < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "${version}"
  on_macos do
    depends_on arch: :arm64
    ${source(names[0])}
  end
  on_linux do
    on_arm do
      ${source(names[1])}
    end
    on_intel do
      ${source(names[2])}
    end
  end
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/dovo-server"
  end
  def caveats
    <<~EOS
      Configure: dovo-server setup
      Start:     dovo-server start
      Pair:      dovo-server pair
      Finish active work and stop before upgrading, then start again.
      Data is stored in ~/.dovo by default and is never removed by uninstall.
      This formula does not register an automatic login service.
    EOS
  end
  test do
    assert_match "Usage:", shell_output("#{bin}/dovo-server --help")
  end
end
`,
)
await writeFile(
  join(output, 'Casks/dovo-studio.rb'),
  `cask "dovo-studio" do
  version "${version}"
  sha256 "${hashes.get(names[3])}"
  url "${base}/${names[3]}"
  name "Dovo Studio"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio.app"
end
`,
)
const tool = (name, platforms) =>
  `\n[tools."http:${name}"]\nversion = "${version}"\nstrip_components = 0\nbin_path = "bin"\n\n[tools."http:${name}".platforms]\n${platforms.map(([platform, file]) => `${platform} = { url = "${base}/${file}", checksum = "sha256:${hashes.get(file)}" }`).join('\n')}\n`
await writeFile(
  join(output, 'mise.toml'),
  '# Version-pinned Dovo release with verified artifact digests.\n' +
    tool('dovo-server', [
      ['macos-arm64', names[0]],
      ['linux-arm64', names[1]],
      ['linux-x64', names[2]],
    ]) +
    tool('dovo-studio', [['macos-arm64', names[4]]]),
)
await writeFile(
  join(output, 'SHA256SUMS'),
  names.map((name) => `${hashes.get(name)}  ${name}\n`).join(''),
)
console.log(`Generated Homebrew and mise definitions for ${version}`)
