class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.964"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.964/Dovo-Server-Nightly-0.0.9-nightly.964-macos-arm64.tar.gz"
      sha256 "a6d78dc2d3505765ef6bbb4fbc72184038d7f45fe95f06422455d32a7324acf2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.964/Dovo-Server-Nightly-0.0.9-nightly.964-linux-arm64.tar.gz"
      sha256 "4913059ec4c13449eff414479937d18863bacd26fd8c2cdb1872e0fac74e6f7b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.964/Dovo-Server-Nightly-0.0.9-nightly.964-linux-x64.tar.gz"
      sha256 "ed38e79bb79caf26be376645f127dfa7f32b77fc6fcd44241f772500831abbfe"
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
