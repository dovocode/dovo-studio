class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1113"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1113/Dovo-Server-Nightly-0.0.9-nightly.1113-macos-arm64.tar.gz"
      sha256 "5a624b2a5fe85bdae514fe82ebc5f740c7ea70bf8cfc13cffd391a6d35da5673"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1113/Dovo-Server-Nightly-0.0.9-nightly.1113-linux-arm64.tar.gz"
      sha256 "195ef6b72463aabb8cc4502cc9e4601c10022d100f486d18e3dfe45b8c3126dd"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1113/Dovo-Server-Nightly-0.0.9-nightly.1113-linux-x64.tar.gz"
      sha256 "11710a1a2d68572169bf5c22ee40419ca5e0f3c31a0b5cbb58da9cfd9f5de9d7"
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
