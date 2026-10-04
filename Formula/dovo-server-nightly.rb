class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.194"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.194/Dovo-Server-Nightly-0.0.7-nightly.194-macos-arm64.tar.gz"
      sha256 "0c433f6408ff2e3f1f54ba88ee56f596d07cae4c91e31c36e6a15ad76484d0c1"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.194/Dovo-Server-Nightly-0.0.7-nightly.194-linux-arm64.tar.gz"
      sha256 "2d6771e660ca0053320b6b9b2eb95bfacd6f8f2e67f35935379c6cfc0776be62"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.194/Dovo-Server-Nightly-0.0.7-nightly.194-linux-x64.tar.gz"
      sha256 "3fe79c721def0fa0296a8b0b5933a5230d70df74d416f3fe9c5b3d9f9e2219bd"
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
