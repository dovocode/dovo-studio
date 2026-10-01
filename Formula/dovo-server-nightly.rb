class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.112"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.112/Dovo-Server-Nightly-0.0.7-nightly.112-macos-arm64.tar.gz"
      sha256 "f4753715d6558aff92ff23ecbc315c718301b6462cdaf3d911e8972194e7c704"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.112/Dovo-Server-Nightly-0.0.7-nightly.112-linux-arm64.tar.gz"
      sha256 "7630150f5a8c072ab2181af60bfccbbb075a5996ffab25afcb53c475321288a2"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.112/Dovo-Server-Nightly-0.0.7-nightly.112-linux-x64.tar.gz"
      sha256 "ab7622429b36ca47085a1e767168da54ee800d484b1bb74402d47a44b5c9bea5"
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
