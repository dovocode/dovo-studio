class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.278"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.278/Dovo-Server-Nightly-0.0.9-nightly.278-macos-arm64.tar.gz"
      sha256 "78b11e901a8d51180b1886f7cd738f4991be3afcd393a32a92277d127758ca45"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.278/Dovo-Server-Nightly-0.0.9-nightly.278-linux-arm64.tar.gz"
      sha256 "892fac532b603696d601e7c0a584a1b42baea6fa2bcd1fddad3736d0dc88cfba"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.278/Dovo-Server-Nightly-0.0.9-nightly.278-linux-x64.tar.gz"
      sha256 "cad4c4dad74d062a026078752e448be7524240af6d562cf6cd71dcf5f1b7c55a"
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
