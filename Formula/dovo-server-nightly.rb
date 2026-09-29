class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.48"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.48/Dovo-Server-Nightly-0.0.7-nightly.48-macos-arm64.tar.gz"
      sha256 "97f5283befcb4cf365d6e647a5f16f1a00fe54fe85bfdd27a0b0e404252b2075"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.48/Dovo-Server-Nightly-0.0.7-nightly.48-linux-arm64.tar.gz"
      sha256 "c68dce0cfd940fde77507f0acf31f7facfa5b1d25b38de7f570c087518840e92"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.48/Dovo-Server-Nightly-0.0.7-nightly.48-linux-x64.tar.gz"
      sha256 "1219f48dc1fac37d2d829c17ec4262cff400c7ae2542ee9b25d0f6453e662abe"
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
