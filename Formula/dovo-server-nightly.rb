class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.789"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.789/Dovo-Server-Nightly-0.0.9-nightly.789-macos-arm64.tar.gz"
      sha256 "e3ae6227a8131bae273bbc2e2b987752913fb49e58259acdafc808c23d9977bd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.789/Dovo-Server-Nightly-0.0.9-nightly.789-linux-arm64.tar.gz"
      sha256 "e766daef30f2eeb0f3d0ecaf0610db80071c83e1f5443a27dadacd0b22814ed7"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.789/Dovo-Server-Nightly-0.0.9-nightly.789-linux-x64.tar.gz"
      sha256 "d19aad1e7eb646a0b02c7fba5bbde54830ae8a85266e8c8bafd1b36a317d40be"
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
