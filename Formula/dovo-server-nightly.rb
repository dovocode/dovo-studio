class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.223"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.223/Dovo-Server-Nightly-0.0.7-nightly.223-macos-arm64.tar.gz"
      sha256 "ac242d2a1a0c7bc387f8f833f070b03cb3b6b4053b4c05163103704060215d26"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.223/Dovo-Server-Nightly-0.0.7-nightly.223-linux-arm64.tar.gz"
      sha256 "de7250c3e87c936c2094df00cadf0776d012c5035b976ae2da9aa5b57fa62c4f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.223/Dovo-Server-Nightly-0.0.7-nightly.223-linux-x64.tar.gz"
      sha256 "593816039f4824ddab3907fb1ef293eeb570e7e9ef3132df9fa5cf3eb5251770"
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
