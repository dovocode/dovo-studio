class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.849"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.849/Dovo-Server-Nightly-0.0.9-nightly.849-macos-arm64.tar.gz"
      sha256 "fa88349bfa3af8ef424d90b02e6249834882a3ed5daafef5e86a1058464d76e5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.849/Dovo-Server-Nightly-0.0.9-nightly.849-linux-arm64.tar.gz"
      sha256 "b05f0e961e4b5587c8ffe636966d2a7a299a04225c962d32ae51c2d7260b3ead"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.849/Dovo-Server-Nightly-0.0.9-nightly.849-linux-x64.tar.gz"
      sha256 "9e15a45424f3f8dafd3aeb63c7635005e02534405a7500ca81543e47ff505565"
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
