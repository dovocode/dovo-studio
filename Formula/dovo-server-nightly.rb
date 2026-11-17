class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.946"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.946/Dovo-Server-Nightly-0.0.9-nightly.946-macos-arm64.tar.gz"
      sha256 "7546a589d0ecabb8b1e9743290dd6408f097292c58b9ffebd41c2ffe99527083"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.946/Dovo-Server-Nightly-0.0.9-nightly.946-linux-arm64.tar.gz"
      sha256 "4ee3bbe8496005c1495009dbca93901228731cd195ca70ea013b75ea4f94f8fb"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.946/Dovo-Server-Nightly-0.0.9-nightly.946-linux-x64.tar.gz"
      sha256 "d38692519b4b9e633bd8b16aaecd4acd7550b2271332e950310b07e265321b31"
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
