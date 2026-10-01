class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.127"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.127/Dovo-Server-Nightly-0.0.7-nightly.127-macos-arm64.tar.gz"
      sha256 "dbd126b177189ef3f9fe2b47c966652dda202b8590dbde27b0a4a6ffd82fed8e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.127/Dovo-Server-Nightly-0.0.7-nightly.127-linux-arm64.tar.gz"
      sha256 "27e97d324c9aea2ffbe9119403bcd65a55775c965ea5e5ebb107930c17409375"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.127/Dovo-Server-Nightly-0.0.7-nightly.127-linux-x64.tar.gz"
      sha256 "c3ab0db347abf58f14ad2db0e518cf14e8b61c344aeae0e2a8384e4d7fbf18a6"
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
