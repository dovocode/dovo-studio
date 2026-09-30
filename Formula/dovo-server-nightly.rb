class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.100"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.100/Dovo-Server-Nightly-0.0.7-nightly.100-macos-arm64.tar.gz"
      sha256 "6fc9244ef1337c60e11495e77db7d3852e67d7ff083d12e4c956864fde45e0b6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.100/Dovo-Server-Nightly-0.0.7-nightly.100-linux-arm64.tar.gz"
      sha256 "88c120e5d78a4bc0e19773e2b789bd41fd37593ad2daa5d75110e02888e2e6d5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.100/Dovo-Server-Nightly-0.0.7-nightly.100-linux-x64.tar.gz"
      sha256 "c72fbe16bea1e818ebc01e06a34a4963c5d60fd78256f47c2a57cb9cfb5ff08e"
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
