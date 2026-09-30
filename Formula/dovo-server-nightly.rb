class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.103"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.103/Dovo-Server-Nightly-0.0.7-nightly.103-macos-arm64.tar.gz"
      sha256 "13c70f2fac1b8c4fc1bbed41ca9a1b25170f24662eab1465f05b4f3b77bca8a7"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.103/Dovo-Server-Nightly-0.0.7-nightly.103-linux-arm64.tar.gz"
      sha256 "a3e26af71716b215e3d663ab91098d312bff71e27e6989564fcbd7205702a2a1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.103/Dovo-Server-Nightly-0.0.7-nightly.103-linux-x64.tar.gz"
      sha256 "7463ff75c349b167e36e7753b77b4f20ed7fcf4e1c3103d4898321503f11052d"
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
