class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.440"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.440/Dovo-Server-Nightly-0.0.9-nightly.440-macos-arm64.tar.gz"
      sha256 "16d6b7e5b9789eb6760d7ea8d865cd573f79523788b518b944de651a75d4aa92"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.440/Dovo-Server-Nightly-0.0.9-nightly.440-linux-arm64.tar.gz"
      sha256 "b836a32233f50ce4ea54ecea5827590a8b9312d390013c0eb0113d838b73e632"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.440/Dovo-Server-Nightly-0.0.9-nightly.440-linux-x64.tar.gz"
      sha256 "3b6d20a9ef2edffa2c2c3956a518b74cc89b90573cc84925c3d25f2121eb03b9"
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
