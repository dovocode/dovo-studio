class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.479"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.479/Dovo-Server-Nightly-0.0.9-nightly.479-macos-arm64.tar.gz"
      sha256 "d7c7e2d17307300355151cc6151294d84bc07d368dff1f60f6f5bba44291ab81"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.479/Dovo-Server-Nightly-0.0.9-nightly.479-linux-arm64.tar.gz"
      sha256 "a44ce8e76af2d7c1611a3d6a315699a7ad96c01661a878091b97cca5f74ea492"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.479/Dovo-Server-Nightly-0.0.9-nightly.479-linux-x64.tar.gz"
      sha256 "311a768c856618e0af079136bdd08b24e9d14c7c96253d09bedaf89b9522d326"
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
