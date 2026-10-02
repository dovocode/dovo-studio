class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.143"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.143/Dovo-Server-Nightly-0.0.7-nightly.143-macos-arm64.tar.gz"
      sha256 "bfa9474b07628a479725b742962a6b7e2518bf90374ec4ae7fb80e39ebfe2bc8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.143/Dovo-Server-Nightly-0.0.7-nightly.143-linux-arm64.tar.gz"
      sha256 "53350e6065e2d2260a9b08e1b9989924fa842be8f0d82e18bbaa1eabdc617187"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.143/Dovo-Server-Nightly-0.0.7-nightly.143-linux-x64.tar.gz"
      sha256 "37702bce54e450b14cdfd5a57f7065c0bf071fb5cc71f4a0e6384064c1271549"
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
