class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.594"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.594/Dovo-Server-Nightly-0.0.9-nightly.594-macos-arm64.tar.gz"
      sha256 "a6edf4354c739c9ee3f9152b4aa5209c38dfc699fb448a9d3be38a2db37610e6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.594/Dovo-Server-Nightly-0.0.9-nightly.594-linux-arm64.tar.gz"
      sha256 "304cce434406304e8914bcfcaa98aec613be39d3d6cac70da32bae02e7a6b569"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.594/Dovo-Server-Nightly-0.0.9-nightly.594-linux-x64.tar.gz"
      sha256 "3350d7c2384ab877b2abe0148e646c7bc98516ccc8b2210321f342e9c5f3a744"
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
