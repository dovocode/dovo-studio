class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.420"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.420/Dovo-Server-Nightly-0.0.9-nightly.420-macos-arm64.tar.gz"
      sha256 "406a9a56c1f8830492692f39760a5ada320f55c8e358f6fe7fda62b7aaa71163"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.420/Dovo-Server-Nightly-0.0.9-nightly.420-linux-arm64.tar.gz"
      sha256 "13226c69a63cd21e0869bfa7fd0411e5f67426375b854d1ca255642e59938ac5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.420/Dovo-Server-Nightly-0.0.9-nightly.420-linux-x64.tar.gz"
      sha256 "71c3bc3e5a86d63bef5397cfc314b2c8d68a36c98cf23ed9afd47290dbe31142"
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
