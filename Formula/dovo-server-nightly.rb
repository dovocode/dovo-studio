class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.96"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.96/Dovo-Server-Nightly-0.0.7-nightly.96-macos-arm64.tar.gz"
      sha256 "0eb73ea87f978cc1983d033d6b1bea339feefa7273b7dd055548e42c645e674b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.96/Dovo-Server-Nightly-0.0.7-nightly.96-linux-arm64.tar.gz"
      sha256 "5719ef243029f7eae6f1db94c86fba982306a20ffa02a833d47595844b872550"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.96/Dovo-Server-Nightly-0.0.7-nightly.96-linux-x64.tar.gz"
      sha256 "2523c657e4917b998dd1ddfa1c9ece8d77ba3c9d57fb7b0fa7e51c10d01d3e51"
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
