class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.603"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.603/Dovo-Server-Nightly-0.0.9-nightly.603-macos-arm64.tar.gz"
      sha256 "e24ca88b9125fd8ad9e9f75742f7fed6a994622217d59c95c43d73f5e795d16a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.603/Dovo-Server-Nightly-0.0.9-nightly.603-linux-arm64.tar.gz"
      sha256 "3bdaa2e4ede61fb53950f29e03067f85be072c4fc0e2497e3406ed9590697144"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.603/Dovo-Server-Nightly-0.0.9-nightly.603-linux-x64.tar.gz"
      sha256 "0506785b7411e0d04f18f27199e9a80ee4aa5503295ada725568482ccc0641dc"
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
