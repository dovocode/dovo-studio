class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.357"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.357/Dovo-Server-Nightly-0.0.9-nightly.357-macos-arm64.tar.gz"
      sha256 "8f1e68724d51b47ffade86c7ca335ef3a53f3a47e432d03b20419dd42871e457"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.357/Dovo-Server-Nightly-0.0.9-nightly.357-linux-arm64.tar.gz"
      sha256 "051d6ec6b3df116f42352fdc38a7f7abdeb8493f25d22909bf108601b1cd8a8e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.357/Dovo-Server-Nightly-0.0.9-nightly.357-linux-x64.tar.gz"
      sha256 "166e365c3622f381104e4ffb39dd59fdbaa0e190932e3f23fb5c7f13fd728f54"
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
