class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.902"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.902/Dovo-Server-Nightly-0.0.9-nightly.902-macos-arm64.tar.gz"
      sha256 "ff7e31a51e1b75e830b2a34cc88b5a8f83bace1e3b52ca84fc1b339d026e0f2e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.902/Dovo-Server-Nightly-0.0.9-nightly.902-linux-arm64.tar.gz"
      sha256 "f85f8f1a6fc64888705b1226b8804252b8d582c0cae4a65e6478fc8b5e631c9f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.902/Dovo-Server-Nightly-0.0.9-nightly.902-linux-x64.tar.gz"
      sha256 "a2cfead673b6212f2ffba8d66005057bf54f260715f5219ba45f99dce76caf05"
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
