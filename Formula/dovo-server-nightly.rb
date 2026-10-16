class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.350"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.350/Dovo-Server-Nightly-0.0.9-nightly.350-macos-arm64.tar.gz"
      sha256 "3f525503707810882e8f3365d9520405f3f9f0c918210ea0af35fc61a89ab44b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.350/Dovo-Server-Nightly-0.0.9-nightly.350-linux-arm64.tar.gz"
      sha256 "c330455903c1699fa1db2cecbd1a00eafe7eca757056b4692abb502f95c212e4"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.350/Dovo-Server-Nightly-0.0.9-nightly.350-linux-x64.tar.gz"
      sha256 "45c332cb7ebd04b8bf0747119c7d1ac627bc20f81ee17210525856f7521ee402"
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
