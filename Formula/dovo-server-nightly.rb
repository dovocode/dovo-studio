class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.52"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.52/Dovo-Server-Nightly-0.0.7-nightly.52-macos-arm64.tar.gz"
      sha256 "608a56d916effb778c2755a20b357d91f8738d71e383ca6375e8dc2080c74e7f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.52/Dovo-Server-Nightly-0.0.7-nightly.52-linux-arm64.tar.gz"
      sha256 "c246e33535bd0dd572ce093defacb3526a61cc350b98e3e2a3720311de5fecc9"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.52/Dovo-Server-Nightly-0.0.7-nightly.52-linux-x64.tar.gz"
      sha256 "5b0b1150dc4462d1d5a5ec05cad2e18f216a5b8605dc9ca089cad5b575b83557"
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
