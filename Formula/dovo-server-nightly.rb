class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.737"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.737/Dovo-Server-Nightly-0.0.9-nightly.737-macos-arm64.tar.gz"
      sha256 "3ba3b3a3463e72197b0937f760199d697578bba30bae435412702b47862b21c6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.737/Dovo-Server-Nightly-0.0.9-nightly.737-linux-arm64.tar.gz"
      sha256 "a92a0b3daf0773e4688d407d676af428805440a9a6ec122325a8a97c6b8d5dd3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.737/Dovo-Server-Nightly-0.0.9-nightly.737-linux-x64.tar.gz"
      sha256 "29a6cd38bb44b7759906c5db43a49d9cef0f5c33c106a2d951e9bdd9df3f1fca"
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
