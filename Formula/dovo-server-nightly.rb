class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.449"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.449/Dovo-Server-Nightly-0.0.9-nightly.449-macos-arm64.tar.gz"
      sha256 "0b1e3129dc86d208d3ffa67443997c6a6f50a4657c76fb02f3c5b314a4f0bfe2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.449/Dovo-Server-Nightly-0.0.9-nightly.449-linux-arm64.tar.gz"
      sha256 "f3aecb5f7ffa6d63330a75391816d5ef6aeaf81ceca071bdaa4571d5785c665a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.449/Dovo-Server-Nightly-0.0.9-nightly.449-linux-x64.tar.gz"
      sha256 "5532db2a4572f427b8bed3fec32f8381a49452816594711e29b91295ddad3542"
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
