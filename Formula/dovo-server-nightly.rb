class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.101"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.101/Dovo-Server-Nightly-0.0.7-nightly.101-macos-arm64.tar.gz"
      sha256 "2d640791330720edb211462e9a991fd6b952c547625cf57371a5f24a1e270aec"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.101/Dovo-Server-Nightly-0.0.7-nightly.101-linux-arm64.tar.gz"
      sha256 "b1a78d6eab681b134828e6818fb7dad2bef8b0a7ee5d9b9558491d3b7280bde1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.101/Dovo-Server-Nightly-0.0.7-nightly.101-linux-x64.tar.gz"
      sha256 "d99b8b17c4c89f6bef5398e6c2f65a5140d92096d23bc1ad2536dd2fa5374661"
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
