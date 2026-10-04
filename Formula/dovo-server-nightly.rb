class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.202"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.202/Dovo-Server-Nightly-0.0.7-nightly.202-macos-arm64.tar.gz"
      sha256 "3cac42154effa58a663cea2397d350e0c372e505846feb3b4f68a6672ad9111f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.202/Dovo-Server-Nightly-0.0.7-nightly.202-linux-arm64.tar.gz"
      sha256 "2a1e30b6771033eafa929e32a3ffd9c82f4a7a2869bb44cda80e1f7a42d43bf1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.202/Dovo-Server-Nightly-0.0.7-nightly.202-linux-x64.tar.gz"
      sha256 "aa69bf3214ccfe0280342cec44b5d9c1a0b50444abd2a9613a3d8bff1a76673f"
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
