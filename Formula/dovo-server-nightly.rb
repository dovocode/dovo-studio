class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.181"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.181/Dovo-Server-Nightly-0.0.7-nightly.181-macos-arm64.tar.gz"
      sha256 "30ac11006af6fa2fe387ee7aa8a2ebb1d93b4ca15253d7f8df0fa34fc51a6cce"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.181/Dovo-Server-Nightly-0.0.7-nightly.181-linux-arm64.tar.gz"
      sha256 "0a7c43293200b0690e4ebff7365d8055d2bbb493c7776548cc2ea089d17e756a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.181/Dovo-Server-Nightly-0.0.7-nightly.181-linux-x64.tar.gz"
      sha256 "41eb74de24ca49d6b97eff891ebaa0bac0bfe1167b228f9ad3ae78b2287bd051"
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
