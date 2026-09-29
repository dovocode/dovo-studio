class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.67"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.67/Dovo-Server-Nightly-0.0.7-nightly.67-macos-arm64.tar.gz"
      sha256 "8e24ffc479c185d8e2c5ad3032e788a7a0601b4d859a1ebc2067414b4f5e2de4"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.67/Dovo-Server-Nightly-0.0.7-nightly.67-linux-arm64.tar.gz"
      sha256 "8097e690741c8b5afadcc6480772a125a6f81caf0fdeb636b0fccf845f153c20"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.67/Dovo-Server-Nightly-0.0.7-nightly.67-linux-x64.tar.gz"
      sha256 "8014f944cc11d6f7945e83bd51f8358fc9113d8ae039f2c3eea452a744e90edd"
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
