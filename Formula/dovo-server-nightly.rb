class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.170"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.170/Dovo-Server-Nightly-0.0.7-nightly.170-macos-arm64.tar.gz"
      sha256 "2d96f4aa3f306ec77835786c4ac40d66af41ded8c1d51196dae9f2f5c3c160fa"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.170/Dovo-Server-Nightly-0.0.7-nightly.170-linux-arm64.tar.gz"
      sha256 "542c8093a025c8ad699b085ea62b5a4df9441e19d3d17ba87f25be486c6517cb"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.170/Dovo-Server-Nightly-0.0.7-nightly.170-linux-x64.tar.gz"
      sha256 "a8fd6f5fe52eb6aec329f1d9ab8713136042e79f69a342e985aa026a8154ed8b"
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
