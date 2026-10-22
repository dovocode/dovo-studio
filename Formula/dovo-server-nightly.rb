class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.456"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.456/Dovo-Server-Nightly-0.0.9-nightly.456-macos-arm64.tar.gz"
      sha256 "e26c80d7db59f3fba5bf0a78695fc1b8f1238df4381ee37c1e85d6666d82869c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.456/Dovo-Server-Nightly-0.0.9-nightly.456-linux-arm64.tar.gz"
      sha256 "82f72dca087b1ff891b97b7b0a9d6f3100b7448e8176451850711453c2110d3e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.456/Dovo-Server-Nightly-0.0.9-nightly.456-linux-x64.tar.gz"
      sha256 "2b3cf71c1f60458de4d2582811bac1d1080f47fb90fb45431d60ba92b43bd652"
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
