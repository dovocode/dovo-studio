class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.35"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.35/Dovo-Server-Nightly-0.0.7-nightly.35-macos-arm64.tar.gz"
      sha256 "3dceb830a1e38732564013db670e755f984c9e89760bbe63d3ce13a84d961671"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.35/Dovo-Server-Nightly-0.0.7-nightly.35-linux-arm64.tar.gz"
      sha256 "f4a4ad830beefb52a783981d6d874b00d7ffd7b4d6b7c4b1764875678ccc07c1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.35/Dovo-Server-Nightly-0.0.7-nightly.35-linux-x64.tar.gz"
      sha256 "91242251965fdf620593beaaf51a1b96f4b2807f0ecffdbff0fb336f96affff0"
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
