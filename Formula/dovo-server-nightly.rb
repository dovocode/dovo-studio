class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.360"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.360/Dovo-Server-Nightly-0.0.9-nightly.360-macos-arm64.tar.gz"
      sha256 "bd5ca652425f23d43a143b9e8adee9561d87b0ecbf08222bdef6f8b72ab72059"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.360/Dovo-Server-Nightly-0.0.9-nightly.360-linux-arm64.tar.gz"
      sha256 "0296c592dba4287563dbd6e0b5884cadadf602557056f2beb6cd107c3872fcb6"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.360/Dovo-Server-Nightly-0.0.9-nightly.360-linux-x64.tar.gz"
      sha256 "839adef42f5592f887a612f3182815648fc50686f40936426ab5f3b10f4665ea"
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
