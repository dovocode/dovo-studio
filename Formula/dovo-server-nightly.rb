class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.842"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.842/Dovo-Server-Nightly-0.0.9-nightly.842-macos-arm64.tar.gz"
      sha256 "4d2cc894b5c469815f0b85703e374ad4a804accc9f96fc1be1b4b5358439f4a2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.842/Dovo-Server-Nightly-0.0.9-nightly.842-linux-arm64.tar.gz"
      sha256 "f8285c8795c6d875e58ff54bb900d0e6b29797cd820b69998f07218c221b0506"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.842/Dovo-Server-Nightly-0.0.9-nightly.842-linux-x64.tar.gz"
      sha256 "72141b29a02a62ee9bb11f8f7f6f1e04cb586f8c8687cd02b4600c357ae0e1d0"
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
