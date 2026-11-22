class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1043"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1043/Dovo-Server-Nightly-0.0.9-nightly.1043-macos-arm64.tar.gz"
      sha256 "d9408676ec6d613cfad2ddcd09d1224f01b981f65b9127674854cb6852cd48c0"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1043/Dovo-Server-Nightly-0.0.9-nightly.1043-linux-arm64.tar.gz"
      sha256 "def8241baa6fca293a603818620efc74e660a41afd3936ec41782d5bbcf5836d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1043/Dovo-Server-Nightly-0.0.9-nightly.1043-linux-x64.tar.gz"
      sha256 "fa681fe4e61cc71cebc00531482b4bfdfd135e7b2128855d3928c7d9da643af2"
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
