class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.323"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.323/Dovo-Server-Nightly-0.0.9-nightly.323-macos-arm64.tar.gz"
      sha256 "9a644857b2002bb4525b10ac3e09ba6918effcb51f75d6ad1377fdd6647d8296"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.323/Dovo-Server-Nightly-0.0.9-nightly.323-linux-arm64.tar.gz"
      sha256 "5a937a89143268e2eccbdaedf34108cabacf18a4c47f7ea38275e1102403904d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.323/Dovo-Server-Nightly-0.0.9-nightly.323-linux-x64.tar.gz"
      sha256 "0664a416b6199517e1118b854d2f1a3f4ae4776c6389540089a92d1f7ee2b234"
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
