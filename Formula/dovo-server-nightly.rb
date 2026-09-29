class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.69"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.69/Dovo-Server-Nightly-0.0.7-nightly.69-macos-arm64.tar.gz"
      sha256 "95ad9e80af03f16987bcee386b18cd153cbae6afde3229cd19846149b30449f8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.69/Dovo-Server-Nightly-0.0.7-nightly.69-linux-arm64.tar.gz"
      sha256 "90e19b98f728fa95585395a582fe2c0a8339585efca053f97ef84ddefbb01cd5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.69/Dovo-Server-Nightly-0.0.7-nightly.69-linux-x64.tar.gz"
      sha256 "a5a9665928d7ff533e5efb0cbbd970cf6672f186dab44938fab233861d776312"
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
