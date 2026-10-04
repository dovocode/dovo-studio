class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.207"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.207/Dovo-Server-Nightly-0.0.7-nightly.207-macos-arm64.tar.gz"
      sha256 "af1b8652c9199d5ef3c7a2d1104628441fba35c465b57cb441e56c620383a2fb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.207/Dovo-Server-Nightly-0.0.7-nightly.207-linux-arm64.tar.gz"
      sha256 "c6c12726d34b06fb8f49798c5a8bed53166efa99b77259769079f44159757bbb"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.207/Dovo-Server-Nightly-0.0.7-nightly.207-linux-x64.tar.gz"
      sha256 "5c252732d7d298845f3003b4bdd1a0879c6bff18cce074a064ce950f8adbcd57"
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
