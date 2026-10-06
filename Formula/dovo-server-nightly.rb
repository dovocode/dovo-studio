class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.239"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.239/Dovo-Server-Nightly-0.0.9-nightly.239-macos-arm64.tar.gz"
      sha256 "03a56a6b0e6e8adaa89e2336c8745963625a2bc2410fa5bb0035c752944152fd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.239/Dovo-Server-Nightly-0.0.9-nightly.239-linux-arm64.tar.gz"
      sha256 "71685899612d27915dc6517399666283719afec278173d675695b1917a3f7299"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.239/Dovo-Server-Nightly-0.0.9-nightly.239-linux-x64.tar.gz"
      sha256 "1a1a707b5acbfbfd910afdc3942b9285794669473278f35c752dd1825254f579"
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
