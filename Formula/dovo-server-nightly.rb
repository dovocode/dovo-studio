class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.797"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.797/Dovo-Server-Nightly-0.0.9-nightly.797-macos-arm64.tar.gz"
      sha256 "489304f4b4c25b81996b9294778e556cc667acc1609be0286d56613a241f2db5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.797/Dovo-Server-Nightly-0.0.9-nightly.797-linux-arm64.tar.gz"
      sha256 "8856c73a4b1d8091b071a9cfffc318f3b08e47905297bfd02722f00d9a7c86a5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.797/Dovo-Server-Nightly-0.0.9-nightly.797-linux-x64.tar.gz"
      sha256 "83e03142c8602c1133a5634dee36e92c1d57df4cfd474e44217015d4c5f7f28d"
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
