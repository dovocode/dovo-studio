class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.681"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.681/Dovo-Server-Nightly-0.0.9-nightly.681-macos-arm64.tar.gz"
      sha256 "4b5d1139395e5b42bc74d8c2046fd47789713c2b75465514c8a0377973bacbdc"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.681/Dovo-Server-Nightly-0.0.9-nightly.681-linux-arm64.tar.gz"
      sha256 "250a9e0cb098b6f549d5b8a72868d2e807996793fdeb024093b622f83c901d4c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.681/Dovo-Server-Nightly-0.0.9-nightly.681-linux-x64.tar.gz"
      sha256 "15c4fc81e5fe963424af8e176f0517ade2de7d7944e3ff79f849c3437450bf24"
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
