class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.727"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.727/Dovo-Server-Nightly-0.0.9-nightly.727-macos-arm64.tar.gz"
      sha256 "4c6c586895c0a75ff8118d65fd06c4f9195ca050550f5b9b804c260a5991202b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.727/Dovo-Server-Nightly-0.0.9-nightly.727-linux-arm64.tar.gz"
      sha256 "029410c32e788859fe700146bcd9bae71f0adc08912f1532522f52761d8b2bd3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.727/Dovo-Server-Nightly-0.0.9-nightly.727-linux-x64.tar.gz"
      sha256 "324c28ed0af4e4bd87cd1a215b29e5609be5c038cf55206c0982a551b88c18c0"
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
