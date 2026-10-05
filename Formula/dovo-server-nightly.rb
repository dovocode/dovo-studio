class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.230"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.230/Dovo-Server-Nightly-0.0.9-nightly.230-macos-arm64.tar.gz"
      sha256 "e6f0a5b929c2ddc3e50400227f68e376d3eb1a058d10ada58a67e08cf7a602d1"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.230/Dovo-Server-Nightly-0.0.9-nightly.230-linux-arm64.tar.gz"
      sha256 "82cd5d28a612347707873cc09979f59a1f183583ead261866e0605a6f8bc11ee"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.230/Dovo-Server-Nightly-0.0.9-nightly.230-linux-x64.tar.gz"
      sha256 "7e5f762357c24e7cc7ef9cc991c93b75bd39d851f1a554ffc8205183d63e2f0f"
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
