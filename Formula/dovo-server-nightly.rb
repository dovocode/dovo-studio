class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.209"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.209/Dovo-Server-Nightly-0.0.7-nightly.209-macos-arm64.tar.gz"
      sha256 "77c6e831bbbf3f53df050d3feafd41ba22f4f3366c88af1aa58d08e316dfcaba"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.209/Dovo-Server-Nightly-0.0.7-nightly.209-linux-arm64.tar.gz"
      sha256 "49d80ffbec8fb173c9782e534a086f14ad31b10d0d53883ce0935829e722458c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.209/Dovo-Server-Nightly-0.0.7-nightly.209-linux-x64.tar.gz"
      sha256 "be4ed3393b510f5d9a21d5e0de429e0d2ab1b2fb0b0c0ffbf6fff428830214b9"
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
