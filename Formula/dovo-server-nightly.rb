class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.72"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.72/Dovo-Server-Nightly-0.0.7-nightly.72-macos-arm64.tar.gz"
      sha256 "15c83744ae2bebb25c5db9d9f3f6a28dec54154312d5a4033bfa5962969f589f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.72/Dovo-Server-Nightly-0.0.7-nightly.72-linux-arm64.tar.gz"
      sha256 "1428a569b66408b09c1414a8e456fd5c3f189646945243786ee85e5cd8e88d80"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.72/Dovo-Server-Nightly-0.0.7-nightly.72-linux-x64.tar.gz"
      sha256 "e06ae6dff08e1a4c07d2a24938dcb0ccf94164c8f42ea8c438fefe69abcd13fd"
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
