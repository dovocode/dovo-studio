class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.30"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.30/Dovo-Server-Nightly-0.0.7-nightly.30-macos-arm64.tar.gz"
      sha256 "0c01d4641098348d96ff45c7f36b96703e93932c148fd588526586a8528098b5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.30/Dovo-Server-Nightly-0.0.7-nightly.30-linux-arm64.tar.gz"
      sha256 "c85e9906b3641a52f58a7da2a9b10f8c532326a8f904eaeb262da5125d52124d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.30/Dovo-Server-Nightly-0.0.7-nightly.30-linux-x64.tar.gz"
      sha256 "a212f1b1d2a25da547904c4a9b094be9407fb7536ffcd2724dfbb3ee8633fb4b"
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
