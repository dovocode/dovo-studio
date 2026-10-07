class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.242"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.242/Dovo-Server-Nightly-0.0.9-nightly.242-macos-arm64.tar.gz"
      sha256 "393bc68ea4debc41c7453363ff88d1787705de6c26e63a52b4b8c1b1b9aff55c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.242/Dovo-Server-Nightly-0.0.9-nightly.242-linux-arm64.tar.gz"
      sha256 "5162593f3f138fadacdff133c544d3660b86b8efec614c47b6fa4ac21745eecd"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.242/Dovo-Server-Nightly-0.0.9-nightly.242-linux-x64.tar.gz"
      sha256 "5da2d065102427a4d4e25e5179a140343e558c37343dd94dbde81809caf9e18e"
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
