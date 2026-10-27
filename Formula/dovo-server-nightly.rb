class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.551"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.551/Dovo-Server-Nightly-0.0.9-nightly.551-macos-arm64.tar.gz"
      sha256 "e636de00b9ee7a8ab3a229292d4f0c1f0f37856276eb3f1348c237e3a6131ac3"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.551/Dovo-Server-Nightly-0.0.9-nightly.551-linux-arm64.tar.gz"
      sha256 "1375a97321dbbd7bf97d0b0d731b54d61683aed0d4f02d6ae3cf9b245baa40e7"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.551/Dovo-Server-Nightly-0.0.9-nightly.551-linux-x64.tar.gz"
      sha256 "63c4337b07f9ab9a69f6d2f396815e38b8ad91909dc1854b53eeb27cdfde4685"
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
