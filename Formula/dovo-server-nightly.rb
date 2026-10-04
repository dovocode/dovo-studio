class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.212"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.212/Dovo-Server-Nightly-0.0.7-nightly.212-macos-arm64.tar.gz"
      sha256 "97756fa5cbfa3bdf1221d99ee93130d6fae60d7ceab91becb84cfafafd677c8b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.212/Dovo-Server-Nightly-0.0.7-nightly.212-linux-arm64.tar.gz"
      sha256 "8ca983c1028c0b56449a1300fe7797fecca8f1d4bf2892d54becf9c6db556147"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.212/Dovo-Server-Nightly-0.0.7-nightly.212-linux-x64.tar.gz"
      sha256 "8de45ed3651333da55b665f72686fa31cc81aca2298fbf4e82601a5945ffe135"
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
