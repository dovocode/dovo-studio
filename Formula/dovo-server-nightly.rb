class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.898"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.898/Dovo-Server-Nightly-0.0.9-nightly.898-macos-arm64.tar.gz"
      sha256 "dfb90572e9ec9aa22beda8a6724531cd418ec671bb4306a5f3c6b81510b6efde"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.898/Dovo-Server-Nightly-0.0.9-nightly.898-linux-arm64.tar.gz"
      sha256 "272b8fa7f044bbba1a5dda67769c4e41502be83c72eb75c726df1c32a3e457b7"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.898/Dovo-Server-Nightly-0.0.9-nightly.898-linux-x64.tar.gz"
      sha256 "6524ba32f8eee8479b59e04018aa36c93eddaf65b0eb835d10cf11bf5cfe779e"
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
