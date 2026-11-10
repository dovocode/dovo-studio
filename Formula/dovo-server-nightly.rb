class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.772"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.772/Dovo-Server-Nightly-0.0.9-nightly.772-macos-arm64.tar.gz"
      sha256 "f1c2882a73d242b04b2185ace2b929a0ece62e2f44f3c3b6980ddfe5aeb81c0d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.772/Dovo-Server-Nightly-0.0.9-nightly.772-linux-arm64.tar.gz"
      sha256 "8dad65f63b7f01b5911ce73cb3a6ed00bf9b4a0a5b813181734435c856bd5225"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.772/Dovo-Server-Nightly-0.0.9-nightly.772-linux-x64.tar.gz"
      sha256 "f229f4f67048e2815e9cdbddd7a91c1631543b3781a0415b1c5c9060408fb32c"
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
