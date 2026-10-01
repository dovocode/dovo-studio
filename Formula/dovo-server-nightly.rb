class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.133"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.133/Dovo-Server-Nightly-0.0.7-nightly.133-macos-arm64.tar.gz"
      sha256 "4d356729977daaaf8123238f12ee3b089eccd4db920fb0906b06443499cc2f30"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.133/Dovo-Server-Nightly-0.0.7-nightly.133-linux-arm64.tar.gz"
      sha256 "ceee0426788a3227177ab85ebad745922c9e34a281986aec3d3b3de4b4f62693"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.133/Dovo-Server-Nightly-0.0.7-nightly.133-linux-x64.tar.gz"
      sha256 "2299ed101db2f38f2b3f42ac1599ddfe12e103c19a16840e277dd64e4cff005b"
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
