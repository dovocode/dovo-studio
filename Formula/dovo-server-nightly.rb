class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.658"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.658/Dovo-Server-Nightly-0.0.9-nightly.658-macos-arm64.tar.gz"
      sha256 "02b327706bcc6939b96fd9b7f210cf6be601a8cf5f5885754ad5a8bc50b102a8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.658/Dovo-Server-Nightly-0.0.9-nightly.658-linux-arm64.tar.gz"
      sha256 "f3ee7920ba6e3c7ba7470abaad798635bf69ef28b9d64834deef61ca91d4b18e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.658/Dovo-Server-Nightly-0.0.9-nightly.658-linux-x64.tar.gz"
      sha256 "f6533079ec7f5ac947abbb9d03bcc0fd62f3e433c8055b49bb90c57288a43b83"
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
