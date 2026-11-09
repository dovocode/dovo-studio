class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.764"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.764/Dovo-Server-Nightly-0.0.9-nightly.764-macos-arm64.tar.gz"
      sha256 "c0981dfafbbc3d5990ccc3141cc32e1ac4ef8e8ed2ac8e0d3660e49efa49929a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.764/Dovo-Server-Nightly-0.0.9-nightly.764-linux-arm64.tar.gz"
      sha256 "4961270e889e30d4c66524f523257e61b5d9238431fa9c99f222f9fa597e647b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.764/Dovo-Server-Nightly-0.0.9-nightly.764-linux-x64.tar.gz"
      sha256 "076509eb5fd1a875ca0b904e7ee684368ad9b896d8afbb82a6760ee19934bfd1"
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
