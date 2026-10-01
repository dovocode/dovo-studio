class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.140"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.140/Dovo-Server-Nightly-0.0.7-nightly.140-macos-arm64.tar.gz"
      sha256 "fb733c51226d96ebf5eb4cd9eb5fbb8ca362ea84656219ac066468b58cb6dfe0"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.140/Dovo-Server-Nightly-0.0.7-nightly.140-linux-arm64.tar.gz"
      sha256 "f40098b3a19073a605afc30ed4c9717eb79ba9a5610363316bc82d96314bb7cc"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.140/Dovo-Server-Nightly-0.0.7-nightly.140-linux-x64.tar.gz"
      sha256 "879d5d2690ddfb12334e47087989ed2a03e55b46257dab022f5076ff9a0e5cd9"
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
