class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.215"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.215/Dovo-Server-Nightly-0.0.7-nightly.215-macos-arm64.tar.gz"
      sha256 "74c016d7d3f6b3db9cd2d878cf68e2028d8ccc1c8e3273081ab41ec4073c9d7c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.215/Dovo-Server-Nightly-0.0.7-nightly.215-linux-arm64.tar.gz"
      sha256 "aae39371334eed1219469912e100e46a092853cb6320a9f6b72c9e12a8aed08a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.215/Dovo-Server-Nightly-0.0.7-nightly.215-linux-x64.tar.gz"
      sha256 "9f3d06a9be57136eed7c6235d11d348d2ac9ce6a8f57a489bad373e7a816036e"
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
