class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.98"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.98/Dovo-Server-Nightly-0.0.7-nightly.98-macos-arm64.tar.gz"
      sha256 "967fa0ead14207deca0366efd130808d7e5f503246bc28702de34bac4604433b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.98/Dovo-Server-Nightly-0.0.7-nightly.98-linux-arm64.tar.gz"
      sha256 "35a0b90ff6be9e491818314e46a815810f7d7d90b330dc50381c7edb93226659"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.98/Dovo-Server-Nightly-0.0.7-nightly.98-linux-x64.tar.gz"
      sha256 "91e80ff413d0ad2b756b1b7be80644a247000b5edbdf8c46c8426eb7d9ca0a09"
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
