class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.84"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.84/Dovo-Server-Nightly-0.0.7-nightly.84-macos-arm64.tar.gz"
      sha256 "3752d02b51dd3b779bccf4177d0b8c79e828f5e331e95cea84359e5c61840fe9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.84/Dovo-Server-Nightly-0.0.7-nightly.84-linux-arm64.tar.gz"
      sha256 "be6ce42562cf2aebce84bb31c471bffcef220383b9b5c307cf11afef18e72ea5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.84/Dovo-Server-Nightly-0.0.7-nightly.84-linux-x64.tar.gz"
      sha256 "ae0ae0c8f95c2a55a4dc18041a2f42eb13b27dbc95dda712689fc23fabdf45da"
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
