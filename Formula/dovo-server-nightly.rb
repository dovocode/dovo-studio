class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.724"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.724/Dovo-Server-Nightly-0.0.9-nightly.724-macos-arm64.tar.gz"
      sha256 "e8fbc8379a8cd4028f24a9c042fff33ec18f4bce66acecd3cbb00bc8438fe2cd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.724/Dovo-Server-Nightly-0.0.9-nightly.724-linux-arm64.tar.gz"
      sha256 "d7d833a715978d6e0a35f966dcf756209a9e8e9047f2fe8e6b75a512a459c89a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.724/Dovo-Server-Nightly-0.0.9-nightly.724-linux-x64.tar.gz"
      sha256 "025382e08c625f8e62c78d5bc15abaf073f98c6419c2cdc2a80c810bcdd94810"
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
