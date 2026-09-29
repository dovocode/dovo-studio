class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.49"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.49/Dovo-Server-Nightly-0.0.7-nightly.49-macos-arm64.tar.gz"
      sha256 "fadd87eafe420ded396506e5089df3579d68c6bf5a512f3a96798b33b057f9c7"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.49/Dovo-Server-Nightly-0.0.7-nightly.49-linux-arm64.tar.gz"
      sha256 "beeb7e7944d6a20cf9c6abab0776aa557c98f330ae83c1f43035166175df0f59"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.49/Dovo-Server-Nightly-0.0.7-nightly.49-linux-x64.tar.gz"
      sha256 "c39026c0c72a7bf82163a1b12c50fd36ed1d686b543718c23b2c1a4d6fd970ad"
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
