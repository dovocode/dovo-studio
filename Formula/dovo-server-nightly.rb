class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.392"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.392/Dovo-Server-Nightly-0.0.9-nightly.392-macos-arm64.tar.gz"
      sha256 "78f14b76348ae578b3f8c2de625431f5afd8e80e4294f9395013ce1d5612b5e7"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.392/Dovo-Server-Nightly-0.0.9-nightly.392-linux-arm64.tar.gz"
      sha256 "7e0706d49421d5e30bef342fcb50c0500a0616591649e71b21e2dc38465ad962"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.392/Dovo-Server-Nightly-0.0.9-nightly.392-linux-x64.tar.gz"
      sha256 "51a423b4764aef7ef169dd5e6799e2b3ba86e8e2ba59d7292bed1c33843272c1"
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
