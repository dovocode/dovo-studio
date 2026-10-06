class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.232"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.232/Dovo-Server-Nightly-0.0.9-nightly.232-macos-arm64.tar.gz"
      sha256 "254c0edb1b8d64b6d3b39e7a3293177e2a26bd7c088729e208c5331759e5b0bc"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.232/Dovo-Server-Nightly-0.0.9-nightly.232-linux-arm64.tar.gz"
      sha256 "ea95b024d03fadb0944385f36367c7efde891e48b458887c65b2c29dcf126d41"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.232/Dovo-Server-Nightly-0.0.9-nightly.232-linux-x64.tar.gz"
      sha256 "31dba420d5c679c042969e1b7eaa77fe759509a6d138406ad9129734efc056ff"
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
