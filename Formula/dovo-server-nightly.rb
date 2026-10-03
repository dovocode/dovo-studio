class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.178"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.178/Dovo-Server-Nightly-0.0.7-nightly.178-macos-arm64.tar.gz"
      sha256 "815ac38dd7d288cd9a0d1f29c3729c935c6cacf1a4339156647643b8f391d0a7"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.178/Dovo-Server-Nightly-0.0.7-nightly.178-linux-arm64.tar.gz"
      sha256 "7817aec1bca0138cac8a2badd5002621f163b81778d3e6bbee360df73b49936a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.178/Dovo-Server-Nightly-0.0.7-nightly.178-linux-x64.tar.gz"
      sha256 "6de8e2e00d4110a185bd608b25113665267b53c76a186e04f7fed1224e44feb9"
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
