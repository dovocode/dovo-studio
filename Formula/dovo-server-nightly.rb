class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.41"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.41/Dovo-Server-Nightly-0.0.7-nightly.41-macos-arm64.tar.gz"
      sha256 "9ced8c098a675b219663e598163c08c32bbfad40e19cfea93761ffe502863986"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.41/Dovo-Server-Nightly-0.0.7-nightly.41-linux-arm64.tar.gz"
      sha256 "abfae9b3d6bce1797e02e3dda501e41a8fb62c35e57a9e412bf8c7421b2e0ea5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.41/Dovo-Server-Nightly-0.0.7-nightly.41-linux-x64.tar.gz"
      sha256 "d4e709b5c5270e7e435d54dec2c337edb9245bcefe2454ef83e84491dfaacb52"
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
