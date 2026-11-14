class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.888"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.888/Dovo-Server-Nightly-0.0.9-nightly.888-macos-arm64.tar.gz"
      sha256 "64115b65c5c8d2e6d6daf787c217a4ab9498e2650d6ee8840ce1f2c804154cdd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.888/Dovo-Server-Nightly-0.0.9-nightly.888-linux-arm64.tar.gz"
      sha256 "66b474e5b392f7883ddfff11477c33146ee15652b53f6df012311136ca2f61e5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.888/Dovo-Server-Nightly-0.0.9-nightly.888-linux-x64.tar.gz"
      sha256 "25e1a0f814ff83bbe0b727d2e6b420249fa5804335178fd728e92cc3ed043a1a"
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
