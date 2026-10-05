class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.224"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.224/Dovo-Server-Nightly-0.0.7-nightly.224-macos-arm64.tar.gz"
      sha256 "2fae48450728ad776d6886e882f27f4e21185155f4d8ee441efe9f252118ee5d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.224/Dovo-Server-Nightly-0.0.7-nightly.224-linux-arm64.tar.gz"
      sha256 "e0be19aeeab933e7e5d1663bc6c26d681e70e6a390b91cdfb20743638e73ff93"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.224/Dovo-Server-Nightly-0.0.7-nightly.224-linux-x64.tar.gz"
      sha256 "2b592acac0eebec529fc98227fbc091009e5e9850ee114d7e534a3afc88a6c9d"
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
