class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.256"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.256/Dovo-Server-Nightly-0.0.9-nightly.256-macos-arm64.tar.gz"
      sha256 "a24a0a9670f84d22dc4a86b3a1294e155a2d8f653ebe81801739d90b90df7e24"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.256/Dovo-Server-Nightly-0.0.9-nightly.256-linux-arm64.tar.gz"
      sha256 "d6fb4c11b677a84be8b5acd6309d82c8193100904210975e30c64f56f643299e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.256/Dovo-Server-Nightly-0.0.9-nightly.256-linux-x64.tar.gz"
      sha256 "48376a1c4fe0fa6643e4848a5ba27d0f090b73b38dd5b25bb24d69c7b775820f"
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
