class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1038"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1038/Dovo-Server-Nightly-0.0.9-nightly.1038-macos-arm64.tar.gz"
      sha256 "dbf4215c5e912e02806654429fc51574da3f6dff9f5d858dd4b2099ec11a8c07"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1038/Dovo-Server-Nightly-0.0.9-nightly.1038-linux-arm64.tar.gz"
      sha256 "bf2626007534e79e2651d971fa74160651270e9e460079c3df7b598f8aa3e683"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1038/Dovo-Server-Nightly-0.0.9-nightly.1038-linux-x64.tar.gz"
      sha256 "77abc850f16a4aece51904385ca2bfdfd21bbf01c033a96ec553716f1ca73131"
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
