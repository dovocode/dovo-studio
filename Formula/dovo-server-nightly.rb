class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.714"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.714/Dovo-Server-Nightly-0.0.9-nightly.714-macos-arm64.tar.gz"
      sha256 "cd207a57e4028082d806acb35cd24846d36012df3d52737b6585ad89faf76aed"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.714/Dovo-Server-Nightly-0.0.9-nightly.714-linux-arm64.tar.gz"
      sha256 "3c5f2d972f9ff667396fe24912959c49cfa6d3af45216faa099154d4dd30efca"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.714/Dovo-Server-Nightly-0.0.9-nightly.714-linux-x64.tar.gz"
      sha256 "ca098335f7b0659a1f4d85f05e251720697227b75baee8036db14b5b2d777ccd"
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
