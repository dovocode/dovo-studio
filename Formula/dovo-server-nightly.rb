class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.123"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.123/Dovo-Server-Nightly-0.0.7-nightly.123-macos-arm64.tar.gz"
      sha256 "5e5c36208b0bd9eb9b24ec2c2cf1de68e35297228e4069dbe8bc01746fb78f30"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.123/Dovo-Server-Nightly-0.0.7-nightly.123-linux-arm64.tar.gz"
      sha256 "8121f234836c94a1ff4bfebc99045c2dc910ce0bd5ee6276efecc59f19780cd4"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.123/Dovo-Server-Nightly-0.0.7-nightly.123-linux-x64.tar.gz"
      sha256 "5c776a1ba0d3aa67186ee9bc2df6db3bc40e73bf779d4932cc2ebb78788fdf5a"
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
