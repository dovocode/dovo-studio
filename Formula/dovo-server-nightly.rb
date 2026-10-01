class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.137"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.137/Dovo-Server-Nightly-0.0.7-nightly.137-macos-arm64.tar.gz"
      sha256 "cdd7256ac7245479cde3cf05f666d29b3f3eebeb398c0f525f60075ff152f8b4"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.137/Dovo-Server-Nightly-0.0.7-nightly.137-linux-arm64.tar.gz"
      sha256 "33aef07986803ccb3e99e6066c214c0adb1dd96fae474e5124bb01a633939e9c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.137/Dovo-Server-Nightly-0.0.7-nightly.137-linux-x64.tar.gz"
      sha256 "6c3d2cce0a2e3f0354e82516531ad10cf0e7b47c07efa880d3deba47af9428e9"
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
