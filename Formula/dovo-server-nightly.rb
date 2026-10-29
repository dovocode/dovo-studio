class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.584"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.584/Dovo-Server-Nightly-0.0.9-nightly.584-macos-arm64.tar.gz"
      sha256 "8ae223a821545091bd2264b7cfcd496cc941882b82de633d9ca8458f957184c0"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.584/Dovo-Server-Nightly-0.0.9-nightly.584-linux-arm64.tar.gz"
      sha256 "ce83f94f428ad60ce49f34bdb1bcfb08eefb206848d420db9be53b68f1ae0a6b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.584/Dovo-Server-Nightly-0.0.9-nightly.584-linux-x64.tar.gz"
      sha256 "965c0f11a9b34c94f04df3bbd60453c7c3c4e6a8ee335b4756be9486d505aa0f"
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
