class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.94"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.94/Dovo-Server-Nightly-0.0.7-nightly.94-macos-arm64.tar.gz"
      sha256 "c1335b47aa57c220f4ee1af7d8faf0352bc2cf07dd944a1c0d733e28502e1624"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.94/Dovo-Server-Nightly-0.0.7-nightly.94-linux-arm64.tar.gz"
      sha256 "7fa213e02bfe74df9538047aabca2cda004940f3d32c9f86f2fdc2c17a42053b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.94/Dovo-Server-Nightly-0.0.7-nightly.94-linux-x64.tar.gz"
      sha256 "9c70722af83796acec9e61d2c7a55f661b1d852afdfd7584357a6e17ef842cde"
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
