class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.135"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.135/Dovo-Server-Nightly-0.0.7-nightly.135-macos-arm64.tar.gz"
      sha256 "f47b5b19c109d2418921e243dc6830ccfd49d1fb611d83c93de21324af796ee8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.135/Dovo-Server-Nightly-0.0.7-nightly.135-linux-arm64.tar.gz"
      sha256 "f8fb7d66c8195b54ef1d4c5b03216097e1146fdd95ca28ba11fd2083988cde58"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.135/Dovo-Server-Nightly-0.0.7-nightly.135-linux-x64.tar.gz"
      sha256 "83dab6bbeb0b570bce803edbab28df5d57cd042e3e23cce04ba378a831c0bd0a"
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
