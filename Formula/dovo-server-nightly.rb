class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.862"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.862/Dovo-Server-Nightly-0.0.9-nightly.862-macos-arm64.tar.gz"
      sha256 "4928ec033ca40ff2fcc23c10a1143ae4c69e4040e182dd72bd12c14ef1992eab"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.862/Dovo-Server-Nightly-0.0.9-nightly.862-linux-arm64.tar.gz"
      sha256 "13760a4ad3b88582ef13fc746f9bdd3fab8a346c20882745ea78022ef2cffb31"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.862/Dovo-Server-Nightly-0.0.9-nightly.862-linux-x64.tar.gz"
      sha256 "4bf6f5315ab779535953e3a9fb3f8bcc07ccdbc424447a9e09bb3cde40d02293"
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
