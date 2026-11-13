class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.868"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.868/Dovo-Server-Nightly-0.0.9-nightly.868-macos-arm64.tar.gz"
      sha256 "2bd57c7f407844b701947c01a828e3b3901d4c8ea9d38f344006960d9c396c62"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.868/Dovo-Server-Nightly-0.0.9-nightly.868-linux-arm64.tar.gz"
      sha256 "586db6ceb712e6117296ef5173265be124b3300394ded001a41d004cea0c41dc"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.868/Dovo-Server-Nightly-0.0.9-nightly.868-linux-x64.tar.gz"
      sha256 "1f05e479e87a5de1bdd00cd155544cd3cbe334f0ea30ee0e2822d3346682dae3"
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
