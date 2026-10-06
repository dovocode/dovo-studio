class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.237"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.237/Dovo-Server-Nightly-0.0.9-nightly.237-macos-arm64.tar.gz"
      sha256 "2c61e8a9bafa1d63f2541647cdb91ae7503040260e20e601e39fdf6b47318e5a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.237/Dovo-Server-Nightly-0.0.9-nightly.237-linux-arm64.tar.gz"
      sha256 "40ded9299a5cc3dc369392a9c79b6e5d6ae09fcc1d1f4714f08a63ec8f6e31a2"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.237/Dovo-Server-Nightly-0.0.9-nightly.237-linux-x64.tar.gz"
      sha256 "0269f2a6c0191731c0bcf9cae552712915953fb2e158b336f9169c4d12f5eeba"
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
