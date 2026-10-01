class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.129"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.129/Dovo-Server-Nightly-0.0.7-nightly.129-macos-arm64.tar.gz"
      sha256 "d67cc70b1c18c90ec0ea89506cb1d222636a2c4f2f207e123fc2b2a8de950a75"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.129/Dovo-Server-Nightly-0.0.7-nightly.129-linux-arm64.tar.gz"
      sha256 "e367494c53e8d8bce3d769cdd91491fd1ff86e8bc2b519ed80e91433bc1b42bc"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.129/Dovo-Server-Nightly-0.0.7-nightly.129-linux-x64.tar.gz"
      sha256 "fcff4aae5db8f59c6edea71d8015e849960a0a28e5c2f38a1e79042bd3dd7e0d"
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
