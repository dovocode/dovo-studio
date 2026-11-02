class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.645"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.645/Dovo-Server-Nightly-0.0.9-nightly.645-macos-arm64.tar.gz"
      sha256 "ef6e5700f61e5bd2b9acef1a40f087f07c440bd600743df3232735d31a687cee"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.645/Dovo-Server-Nightly-0.0.9-nightly.645-linux-arm64.tar.gz"
      sha256 "225cfa29d4b227c3470508e00f2acffaad4c3e037071b8dcaa7d1c0dc221d2bb"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.645/Dovo-Server-Nightly-0.0.9-nightly.645-linux-x64.tar.gz"
      sha256 "7b9dda579f3c94210b7dded8d4d2be23dbc6b0570519c45604aeba0872cbd071"
    end
  end
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/dovo-server-nightly"
  end
  def caveats
    <<~EOS
      Configure: dovo-server-nightly setup
      Start:     dovo-server-nightly start
      Pair:      dovo-server-nightly pair
      Finish active work and stop before upgrading, then start again.
      Data is stored in ~/.dovo by default and is never removed by uninstall.
      This formula does not register an automatic login service.
    EOS
  end
  test do
    assert_match "Usage:", shell_output("#{bin}/dovo-server-nightly --help")
  end
end
