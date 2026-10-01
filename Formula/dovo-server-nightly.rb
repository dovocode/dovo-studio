class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.113"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.113/Dovo-Server-Nightly-0.0.7-nightly.113-macos-arm64.tar.gz"
      sha256 "95643b94aadf6b1aa2d8cd2485d95d69f2e99d10a0694d3ddf1730a00e66fbe6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.113/Dovo-Server-Nightly-0.0.7-nightly.113-linux-arm64.tar.gz"
      sha256 "ed7d1e82a57067ae69b305fd40de0bcea70db875b513f583a4e70fdd355babdd"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.113/Dovo-Server-Nightly-0.0.7-nightly.113-linux-x64.tar.gz"
      sha256 "82babd99a31531ee962f575b9a0ca74b6317530d6593d6190407976e7ad231ca"
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
