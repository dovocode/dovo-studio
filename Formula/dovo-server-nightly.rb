class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.258"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.258/Dovo-Server-Nightly-0.0.9-nightly.258-macos-arm64.tar.gz"
      sha256 "dcee297fe0d51f182118c5d1c96c6e202de0b19c083c8717749ee9ca81b88855"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.258/Dovo-Server-Nightly-0.0.9-nightly.258-linux-arm64.tar.gz"
      sha256 "6412128398a2e52a014025ad05ed409f8347de542c75859a4616e986eeafa0c4"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.258/Dovo-Server-Nightly-0.0.9-nightly.258-linux-x64.tar.gz"
      sha256 "efb8466b1adcda58a8784f25798790629535d718aeedc3a9b780f5c489dfd668"
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
