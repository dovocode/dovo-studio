class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.66"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.66/Dovo-Server-Nightly-0.0.7-nightly.66-macos-arm64.tar.gz"
      sha256 "1bd04a1febaf8324876a9c5d3805a0b3e81f89a2b3cb3769f49a6c758ebc1455"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.66/Dovo-Server-Nightly-0.0.7-nightly.66-linux-arm64.tar.gz"
      sha256 "1ccbce1dde33a66004b401871a0be27717ed5151bceaa197c52c4d37f98c069c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.66/Dovo-Server-Nightly-0.0.7-nightly.66-linux-x64.tar.gz"
      sha256 "f295d98c6e6ae8ce496952ab8392361fb6f7e2fcbf30c7215defeb29ad42ecc3"
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
