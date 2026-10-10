class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.266"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.266/Dovo-Server-Nightly-0.0.9-nightly.266-macos-arm64.tar.gz"
      sha256 "df5bf10c3373d4bd166a670044e9a19e36a467ba5d1d6f57d8edbef6eff42e22"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.266/Dovo-Server-Nightly-0.0.9-nightly.266-linux-arm64.tar.gz"
      sha256 "4bd0e2b0b3b05a5c26bf5467d49bf96fb022405f4fa54aadb219053f76a69f41"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.266/Dovo-Server-Nightly-0.0.9-nightly.266-linux-x64.tar.gz"
      sha256 "bec7ff4ac8cd28ce982e2e7edf908b98c7de2c70bb4ba9d97276d430f254f6c6"
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
