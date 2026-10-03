class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.187"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.187/Dovo-Server-Nightly-0.0.7-nightly.187-macos-arm64.tar.gz"
      sha256 "f25b8f4aa944425dca57351150ddefc5a81eee553860f9c407e40c3dd3a8e25d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.187/Dovo-Server-Nightly-0.0.7-nightly.187-linux-arm64.tar.gz"
      sha256 "4a80a0721c1c0239e74abff0d5e7dcbb020938f78e585c2999df54d6e6c64701"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.187/Dovo-Server-Nightly-0.0.7-nightly.187-linux-x64.tar.gz"
      sha256 "d14670492eb7d63e2228b36937cff5c302140a8587abb0e7569d2131930827d3"
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
