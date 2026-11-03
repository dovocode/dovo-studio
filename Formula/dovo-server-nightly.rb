class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.680"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.680/Dovo-Server-Nightly-0.0.9-nightly.680-macos-arm64.tar.gz"
      sha256 "2b0a4b1c8d6fd6ecf1f6568a5e33e1392cfe51e1308e10f19de5d1dc503292fc"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.680/Dovo-Server-Nightly-0.0.9-nightly.680-linux-arm64.tar.gz"
      sha256 "7f0539d83c5a0c7495ce36bbb003c966cd0357581e5c4028e182ad9596cee661"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.680/Dovo-Server-Nightly-0.0.9-nightly.680-linux-x64.tar.gz"
      sha256 "1602cd0466e713753f3a0edfd5b0b1eaa2314d795dedc8db53ea139d0d82d95c"
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
