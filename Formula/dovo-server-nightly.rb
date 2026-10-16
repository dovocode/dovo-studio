class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.355"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.355/Dovo-Server-Nightly-0.0.9-nightly.355-macos-arm64.tar.gz"
      sha256 "caabb1f5a0a571c5eccd2ee15405d73e517ef157d4a8b80607637cb2726a8bcd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.355/Dovo-Server-Nightly-0.0.9-nightly.355-linux-arm64.tar.gz"
      sha256 "916da5543c5a18c9143eaf1d274f2a2f2d79e662f81e1f0b42200c7f660183ea"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.355/Dovo-Server-Nightly-0.0.9-nightly.355-linux-x64.tar.gz"
      sha256 "9d3c697bc716dfdd0e3c9cc1cc296b642a7908940f4717beef57faf6f0d46875"
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
