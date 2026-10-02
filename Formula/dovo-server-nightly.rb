class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.144"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.144/Dovo-Server-Nightly-0.0.7-nightly.144-macos-arm64.tar.gz"
      sha256 "d0823d83fcb6e67f0d3c48f3be9265e4ce70b1ee14cd36f1a825b42ce6bbc845"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.144/Dovo-Server-Nightly-0.0.7-nightly.144-linux-arm64.tar.gz"
      sha256 "dcd0a64dab3e06c2f90a113465c9cce8185106ebd9f68154ea23211eea6f230f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.144/Dovo-Server-Nightly-0.0.7-nightly.144-linux-x64.tar.gz"
      sha256 "9b6c4264f000c86521b1af1184373e8e9f38bee4738130baa503b1a277c11215"
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
