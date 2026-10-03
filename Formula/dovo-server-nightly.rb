class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.177"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.177/Dovo-Server-Nightly-0.0.7-nightly.177-macos-arm64.tar.gz"
      sha256 "e464fb45bf0251ec5781af130925c87bf76d2ac99cd2ed54118ce3fa5d10d58f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.177/Dovo-Server-Nightly-0.0.7-nightly.177-linux-arm64.tar.gz"
      sha256 "81255d0074b5b68d965ab58831839fbb3b2454602c1f61ed3f52ea9a107d286e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.177/Dovo-Server-Nightly-0.0.7-nightly.177-linux-x64.tar.gz"
      sha256 "1b1d7fd65ccdc315f575c52bdf34193aed6c0dc7b7fdd6c3a1e2da1b70ecaaae"
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
