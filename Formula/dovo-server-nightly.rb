class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.602"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.602/Dovo-Server-Nightly-0.0.9-nightly.602-macos-arm64.tar.gz"
      sha256 "2b3f735b06320394cfc8d2291b0870c8a45f8f4e89c7bc7f252225e129479d53"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.602/Dovo-Server-Nightly-0.0.9-nightly.602-linux-arm64.tar.gz"
      sha256 "5c0c9475cbf737a58b5861d2338610dda3f5b3e9e909c1ccd962818b6bee2793"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.602/Dovo-Server-Nightly-0.0.9-nightly.602-linux-x64.tar.gz"
      sha256 "fd39755c66253a5c465693f019c8fc558ca03f4d5f616d2d8b3d1f1baf6560a1"
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
