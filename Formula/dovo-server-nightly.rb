class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.111"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.111/Dovo-Server-Nightly-0.0.7-nightly.111-macos-arm64.tar.gz"
      sha256 "a163174cfe7e4195947696c7f9907cd64c96617e04a22df289df40fe727e3d02"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.111/Dovo-Server-Nightly-0.0.7-nightly.111-linux-arm64.tar.gz"
      sha256 "721965f1c2329ccab65641cad793d90c3141ce65f284dac0f918196a39b951cc"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.111/Dovo-Server-Nightly-0.0.7-nightly.111-linux-x64.tar.gz"
      sha256 "23b63e114ee1118a06a2fabd4f1b405a0bd3b66277fa5b488daaa7bf20d7ec24"
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
