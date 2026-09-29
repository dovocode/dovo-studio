class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.37"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.37/Dovo-Server-Nightly-0.0.7-nightly.37-macos-arm64.tar.gz"
      sha256 "98312844f724abf68a60875916d7f2ce674fbb314794266b765fbe979b380979"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.37/Dovo-Server-Nightly-0.0.7-nightly.37-linux-arm64.tar.gz"
      sha256 "629a1b623a8cf3dcbbb596bac82e8bb2b563d126d221c3986cb48f15d6611218"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.37/Dovo-Server-Nightly-0.0.7-nightly.37-linux-x64.tar.gz"
      sha256 "2871e9076901935f72058ea5ca1d31ea490b9aa8cd72b347a073670c9f2da8de"
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
