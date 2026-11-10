class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.782"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.782/Dovo-Server-Nightly-0.0.9-nightly.782-macos-arm64.tar.gz"
      sha256 "7b892490ed89494bc758029cf1559d6718ddf8ace39cd86961f7b75ee9c123c5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.782/Dovo-Server-Nightly-0.0.9-nightly.782-linux-arm64.tar.gz"
      sha256 "81e0592854994b4f41bcccc10b5bc4b53affec8bf107df74833f43741d5cfaf3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.782/Dovo-Server-Nightly-0.0.9-nightly.782-linux-x64.tar.gz"
      sha256 "5dcb86ea0898243d28c26fdf1b8122e5dde947301c07b436084d4df269b906cb"
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
