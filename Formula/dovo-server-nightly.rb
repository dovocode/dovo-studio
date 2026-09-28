class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.25"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.25/Dovo-Server-Nightly-0.0.7-nightly.25-macos-arm64.tar.gz"
      sha256 "549f7473024a967f014334d37a9c1df9285eddd0f6c069f7c62f55ea1fb66e93"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.25/Dovo-Server-Nightly-0.0.7-nightly.25-linux-arm64.tar.gz"
      sha256 "f25626993ef82f12c645052c30a5472582073df9567dcd713253b56f2b6ca60f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.25/Dovo-Server-Nightly-0.0.7-nightly.25-linux-x64.tar.gz"
      sha256 "1340a69b25bb268eef76a67e57def9d588ee2e2cfeafeca5db693380896cda81"
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
