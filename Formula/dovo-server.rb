class DovoServer < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.4"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.4/Dovo-Server-0.0.4-macos-arm64.tar.gz"
      sha256 "27f73ff4904145f88c11e1d0fca084b8089fabc77b9e79aab09710e8f3320582"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.4/Dovo-Server-0.0.4-linux-arm64.tar.gz"
      sha256 "014390d2d121f0e1bf32f94f71fd452309e253c8b4d2f7190483e763d7c2ab4e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.4/Dovo-Server-0.0.4-linux-x64.tar.gz"
      sha256 "82dabe06cfdf570e0eb6a1ee3514fdab987a558a6f35416c3d7722e31609600a"
    end
  end
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/dovo-server"
  end
  def caveats
    <<~EOS
      Configure: dovo-server setup
      Start:     dovo-server start
      Pair:      dovo-server pair
      Finish active work and stop before upgrading, then start again.
      Data is stored in ~/.dovo by default and is never removed by uninstall.
      This formula does not register an automatic login service.
    EOS
  end
  test do
    assert_match "Usage:", shell_output("#{bin}/dovo-server --help")
  end
end
