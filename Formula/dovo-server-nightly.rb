class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.822"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.822/Dovo-Server-Nightly-0.0.9-nightly.822-macos-arm64.tar.gz"
      sha256 "41b751dccb0a5f898d9312e591d8a0e3209930bc93d246445f1e679b220e2156"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.822/Dovo-Server-Nightly-0.0.9-nightly.822-linux-arm64.tar.gz"
      sha256 "df8805052e575b205002fdaa22a1d3ab039cbb61c9f03dd6801fd19187b93f5a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.822/Dovo-Server-Nightly-0.0.9-nightly.822-linux-x64.tar.gz"
      sha256 "6b5918995fd5907a1a244243b646b63c2baeaaa778c0cd35565f206520e88a14"
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
