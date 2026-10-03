class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.179"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.179/Dovo-Server-Nightly-0.0.7-nightly.179-macos-arm64.tar.gz"
      sha256 "ac6465b099d33d2e866cfccdc1859381f206829b0e69bed9d978bb886926723c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.179/Dovo-Server-Nightly-0.0.7-nightly.179-linux-arm64.tar.gz"
      sha256 "bc46047d52a69cb2d3a641caaa19c8da50ce08036e94945c495b96becbede3a9"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.179/Dovo-Server-Nightly-0.0.7-nightly.179-linux-x64.tar.gz"
      sha256 "bd500310fdee15efb996712e0243ff576895417353cfe1af5a642548b27eabe4"
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
