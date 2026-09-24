class DovoServer < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.3"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.3/Dovo-Server-0.0.3-macos-arm64.tar.gz"
      sha256 "73966e8946884ce3a9ca947fd6f73bd9a70031c35b15507a327487429059982c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.3/Dovo-Server-0.0.3-linux-arm64.tar.gz"
      sha256 "ec35db5b0cd4a0bcd154840525536958bcfcf77a85fe1d4342bdc4096046fd21"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.3/Dovo-Server-0.0.3-linux-x64.tar.gz"
      sha256 "d9da486879975789261e05866535cdc0aaae22b8e51e5c7a93b62db919131326"
    end
  end
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/dovo-server"
  end
  def caveats
    <<~EOS
      Configure: dovo-server setup
      Start:     dovo-server start
      Pair:      dovo-server pair
      Finish active work and stop before upgrading, then start again.
      Data is stored in ~/.dovo by default and is never removed by uninstall.
      This formula does not register an automatic login service.
    EOS
  end
  test do
    assert_match "Usage:", shell_output("#{bin}/dovo-server --help")
  end
end
