class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.672"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.672/Dovo-Server-Nightly-0.0.9-nightly.672-macos-arm64.tar.gz"
      sha256 "2ea900097dd429b37024169b7597ab4a17de54e27429eb6c5fe91a395f5182bc"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.672/Dovo-Server-Nightly-0.0.9-nightly.672-linux-arm64.tar.gz"
      sha256 "4436765541042c09e4c98ba5d13a24a007856dec208e2557859cbd9f3f14c9fd"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.672/Dovo-Server-Nightly-0.0.9-nightly.672-linux-x64.tar.gz"
      sha256 "8e32199ea46092008cff131ca2ee40ec015bad7c08c094d446f933c6005246aa"
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
