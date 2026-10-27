class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.550"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.550/Dovo-Server-Nightly-0.0.9-nightly.550-macos-arm64.tar.gz"
      sha256 "ab5abbc688c8ca981e928d086f05abdbd43aeb3fc650f4f59cac7347aecff077"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.550/Dovo-Server-Nightly-0.0.9-nightly.550-linux-arm64.tar.gz"
      sha256 "15be892f1ef91ee03bd0fee8a870a8c8ab9395b22462e823669a773ad09e0761"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.550/Dovo-Server-Nightly-0.0.9-nightly.550-linux-x64.tar.gz"
      sha256 "1481ed68f2b6c3517e0c067154fdb1bad46c55ee845d2c1265459f4cbed4fbdf"
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
