class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.428"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.428/Dovo-Server-Nightly-0.0.9-nightly.428-macos-arm64.tar.gz"
      sha256 "19eda9f60b8f2171e5ff4ba8c279f5c5a15deaecd8f5a71d50e3c389adf07abc"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.428/Dovo-Server-Nightly-0.0.9-nightly.428-linux-arm64.tar.gz"
      sha256 "69f81ed98f5297d0970655177964d120e9402e359cd6cd427808e4a75a171b5f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.428/Dovo-Server-Nightly-0.0.9-nightly.428-linux-x64.tar.gz"
      sha256 "8d4718c2607b15e450135671cde177c7990e4c68045ab28801bc74f2cfb1b667"
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
