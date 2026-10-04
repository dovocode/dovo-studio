class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.192"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.192/Dovo-Server-Nightly-0.0.7-nightly.192-macos-arm64.tar.gz"
      sha256 "6424bcf3ff91599a3d795be772aeb817895c32c4ee11bfea7bd645814c283a30"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.192/Dovo-Server-Nightly-0.0.7-nightly.192-linux-arm64.tar.gz"
      sha256 "226bdfd3b2b87d05586c98a46227bd4a28440a204d9d8b15107030ae17a94eb1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.192/Dovo-Server-Nightly-0.0.7-nightly.192-linux-x64.tar.gz"
      sha256 "cd6d527162419066babac5e9c81dc072585fa2f1616892fe4e21908fa02f2765"
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
