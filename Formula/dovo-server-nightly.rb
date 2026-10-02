class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.154"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.154/Dovo-Server-Nightly-0.0.7-nightly.154-macos-arm64.tar.gz"
      sha256 "cfa5df855282db267bb7063ccc96bd1fb0073f25759a6a64be002aed328efb56"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.154/Dovo-Server-Nightly-0.0.7-nightly.154-linux-arm64.tar.gz"
      sha256 "987d786db68dce22dd9d5efbfdbc4d6e22d3a5ac25553f6b4a9bf51e79f9c744"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.154/Dovo-Server-Nightly-0.0.7-nightly.154-linux-x64.tar.gz"
      sha256 "de64ddfd9c3f54c694b7f988724ee35ed1d40bce90e87df1025790bd4c1c1ec9"
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
