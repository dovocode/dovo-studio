class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.200"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.200/Dovo-Server-Nightly-0.0.7-nightly.200-macos-arm64.tar.gz"
      sha256 "e869e54d40eec17cfd0ebbd620ebb17bc731c75f4138c1d95ba566648e9a00a8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.200/Dovo-Server-Nightly-0.0.7-nightly.200-linux-arm64.tar.gz"
      sha256 "fb18d41430c691bb068a5b78b5b6374a2dbc9d288fc2502578da9878eddd7324"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.200/Dovo-Server-Nightly-0.0.7-nightly.200-linux-x64.tar.gz"
      sha256 "f533c8f02806e49a9d8c712ac60411182fa6145aaaa7154874927fb3e71f5595"
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
