class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.684"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.684/Dovo-Server-Nightly-0.0.9-nightly.684-macos-arm64.tar.gz"
      sha256 "4482b2915b6ee4d86eff28006d856626c5f26a7fd5b9de2320e1539745dc8000"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.684/Dovo-Server-Nightly-0.0.9-nightly.684-linux-arm64.tar.gz"
      sha256 "37396bc2c9133b2761b3fc47d82e937283cdb0bc3a17f21ea535992976158d93"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.684/Dovo-Server-Nightly-0.0.9-nightly.684-linux-x64.tar.gz"
      sha256 "c080f9578125da182c5ce91ae84956e2908a037db8ccf8c588ec0b68919ba174"
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
