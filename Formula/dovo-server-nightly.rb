class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.88"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.88/Dovo-Server-Nightly-0.0.7-nightly.88-macos-arm64.tar.gz"
      sha256 "f5d1d13c8e1db30c3e70839548e40e63b0ced981b9645755161deed9f2a0a0aa"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.88/Dovo-Server-Nightly-0.0.7-nightly.88-linux-arm64.tar.gz"
      sha256 "9f13199e9e0d1a3123577ed13bfb514ace6e86adbc4f3af647fd3855eea188b3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.88/Dovo-Server-Nightly-0.0.7-nightly.88-linux-x64.tar.gz"
      sha256 "4762412b1bef4b7223f620b4b9788343826cff55e01f4fe6d08c9016c28fbd4e"
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
