class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.118"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.118/Dovo-Server-Nightly-0.0.7-nightly.118-macos-arm64.tar.gz"
      sha256 "54c2c1a0a3b39a1c2cf9ccf112e83e6564d16716850ee91ebf92d30649f50d5c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.118/Dovo-Server-Nightly-0.0.7-nightly.118-linux-arm64.tar.gz"
      sha256 "c8e50d2fa051c982f099041b84bc9690588f19c5e7ecf88207d4e886d6ab1698"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.118/Dovo-Server-Nightly-0.0.7-nightly.118-linux-x64.tar.gz"
      sha256 "8a598940837913aeb643ee68fb658577f7dc619a76225ab052016b6cfc86018c"
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
