class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.259"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.259/Dovo-Server-Nightly-0.0.9-nightly.259-macos-arm64.tar.gz"
      sha256 "b62deced12d349efa91158599581ec5cc57c1454ddf675922c3f3b1adc4cb1c3"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.259/Dovo-Server-Nightly-0.0.9-nightly.259-linux-arm64.tar.gz"
      sha256 "c936706e01aaab8c0b179a1a73d7f3a8018710a9ad5f60a67b2cf2c3705272c1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.259/Dovo-Server-Nightly-0.0.9-nightly.259-linux-x64.tar.gz"
      sha256 "6141c95923ae8fef67a67791db58c579b405419dd0570a75817d600261396f7a"
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
