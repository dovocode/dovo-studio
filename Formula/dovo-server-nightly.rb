class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.195"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.195/Dovo-Server-Nightly-0.0.7-nightly.195-macos-arm64.tar.gz"
      sha256 "b9437d7f1c6d61aa78f87b05fcb54cc191da81280ebc7b1b4ad67cac6c7bfe15"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.195/Dovo-Server-Nightly-0.0.7-nightly.195-linux-arm64.tar.gz"
      sha256 "08b3d28ba57b143a9db90e17f381614e94c7d485798667308aa10c4ee52fd845"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.195/Dovo-Server-Nightly-0.0.7-nightly.195-linux-x64.tar.gz"
      sha256 "e95eee5cb258eaf29837376a480d4f0a90cb40d720cd87e08b115185bad67b34"
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
