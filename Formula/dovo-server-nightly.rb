class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.542"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.542/Dovo-Server-Nightly-0.0.9-nightly.542-macos-arm64.tar.gz"
      sha256 "7adb2e22c182e3ac1c35b4b1a40e43918653d99493d1dab99f0f958395660efa"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.542/Dovo-Server-Nightly-0.0.9-nightly.542-linux-arm64.tar.gz"
      sha256 "55a541d1217cff655f9d6e677d32588d14cd8a5304d2175e013fef490ebf0717"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.542/Dovo-Server-Nightly-0.0.9-nightly.542-linux-x64.tar.gz"
      sha256 "a8f8d5bf3cdb9667106a9ce91ba9d214d07292efe2f4f6abe11b935f6fdc1ef7"
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
