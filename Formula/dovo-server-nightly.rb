class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.56"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.56/Dovo-Server-Nightly-0.0.7-nightly.56-macos-arm64.tar.gz"
      sha256 "a22c2245214bf1bdcba33c22d9042c1c9781c9c1a4fc2b42e2fd668ea75646b2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.56/Dovo-Server-Nightly-0.0.7-nightly.56-linux-arm64.tar.gz"
      sha256 "bee1ffdc316c97f0511d7ffc1624816eb93f73f7b02bd48a9b25e7e5ae6d4b86"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.56/Dovo-Server-Nightly-0.0.7-nightly.56-linux-x64.tar.gz"
      sha256 "8c7cf57f637d7224f815ddc327f6d456c4e4b4225daac22761c2d6fcd3813463"
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
