class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.55"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.55/Dovo-Server-Nightly-0.0.7-nightly.55-macos-arm64.tar.gz"
      sha256 "e2c9ee55225b4c081e09236c360527aab7ac465b053a9631fe34d9de4970d3d8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.55/Dovo-Server-Nightly-0.0.7-nightly.55-linux-arm64.tar.gz"
      sha256 "bd208ac8c851cd7ea0ab87b2b8d6f301d7f15e7e9a240b58d2027c7b99531286"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.55/Dovo-Server-Nightly-0.0.7-nightly.55-linux-x64.tar.gz"
      sha256 "6e998c0fbeef863ae635737a81d6709a5ffdf65d6e52c30d81c478660fb67ee3"
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
