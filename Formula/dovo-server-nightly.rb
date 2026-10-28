class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.561"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.561/Dovo-Server-Nightly-0.0.9-nightly.561-macos-arm64.tar.gz"
      sha256 "ccd83f1981b3beab0ceb2d23b257698567f11e1680502170f058c8ef18b00a74"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.561/Dovo-Server-Nightly-0.0.9-nightly.561-linux-arm64.tar.gz"
      sha256 "2a094078b2e0891dbb88908b494aeda877dc21e4ef7402fc1184b925bb47357c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.561/Dovo-Server-Nightly-0.0.9-nightly.561-linux-x64.tar.gz"
      sha256 "01a721b0ec23e7d9851a2aac7d775ca3b07545ec9b3ab22ce175189623f1e8ad"
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
