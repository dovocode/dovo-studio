class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.883"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.883/Dovo-Server-Nightly-0.0.9-nightly.883-macos-arm64.tar.gz"
      sha256 "bedd6ee6d7988546ed80333e1d5994d1f28b0c410c78b377e3062126f8545c36"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.883/Dovo-Server-Nightly-0.0.9-nightly.883-linux-arm64.tar.gz"
      sha256 "a58fb4b5a628ba8688072c039a2c65b75644874a2703885648379c773c33f7b0"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.883/Dovo-Server-Nightly-0.0.9-nightly.883-linux-x64.tar.gz"
      sha256 "869468d8a08b08bd8df2684a6d9f6f815c68b2fb1df1aa06fbe4fb5090c8c12b"
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
