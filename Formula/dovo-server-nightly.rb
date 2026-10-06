class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.234"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.234/Dovo-Server-Nightly-0.0.9-nightly.234-macos-arm64.tar.gz"
      sha256 "f2721912a01718213f18a1db960d611281331ed6cbdcce251d0b0942a90b6c58"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.234/Dovo-Server-Nightly-0.0.9-nightly.234-linux-arm64.tar.gz"
      sha256 "7d68ede23e80d2a9d4f4571a037afbc80f92a43e32305b30a9d0cb48c0d341e6"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.234/Dovo-Server-Nightly-0.0.9-nightly.234-linux-x64.tar.gz"
      sha256 "255c9b3174c16afacb783dfff4ac1a58ab2c3133e44a5cace69c8525fdb55073"
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
