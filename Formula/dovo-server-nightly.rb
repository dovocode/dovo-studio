class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.375"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.375/Dovo-Server-Nightly-0.0.9-nightly.375-macos-arm64.tar.gz"
      sha256 "3f48cec2fda69dc069c0d3eb9a73c0ae56a05099c471d2e3d6800059cb0bd036"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.375/Dovo-Server-Nightly-0.0.9-nightly.375-linux-arm64.tar.gz"
      sha256 "4cedbd84fc142b9fdf826a37e44e16d0b872cab2bc638d8294a2c428a8782d8a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.375/Dovo-Server-Nightly-0.0.9-nightly.375-linux-x64.tar.gz"
      sha256 "2b4bc8ef55b7b29335b76fc281ef3d7e66ac614beeeda4c3256e5a2ba085092d"
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
