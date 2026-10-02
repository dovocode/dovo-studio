class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.159"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.159/Dovo-Server-Nightly-0.0.7-nightly.159-macos-arm64.tar.gz"
      sha256 "c935960019d5ca12a23c1cd0b5fadc5cc2633a6083e8656ecc209a066f3986fc"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.159/Dovo-Server-Nightly-0.0.7-nightly.159-linux-arm64.tar.gz"
      sha256 "3c86457baa2155ae02bb60c3a2351bc02a69b6d5f5d131f59e3d40ca2c111018"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.159/Dovo-Server-Nightly-0.0.7-nightly.159-linux-x64.tar.gz"
      sha256 "25c5a27316c37260b6ac7755e6e20f4512f90be7cadbf300976957e448a8d624"
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
