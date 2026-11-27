class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1119"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1119/Dovo-Server-Nightly-0.0.9-nightly.1119-macos-arm64.tar.gz"
      sha256 "adb24b22af416b1d90b62759762d0258a67520e43f2598fe4718a07d4ea79905"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1119/Dovo-Server-Nightly-0.0.9-nightly.1119-linux-arm64.tar.gz"
      sha256 "e156a2124363a0ec48439320b120261f17ae91ddaadd5555eea5b186ea6fee1b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1119/Dovo-Server-Nightly-0.0.9-nightly.1119-linux-x64.tar.gz"
      sha256 "1552439c6548bb031beb9601ac530198f814f4cfcc9a1526f619c19dbb85bd21"
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
