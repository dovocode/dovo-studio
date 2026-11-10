class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.785"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.785/Dovo-Server-Nightly-0.0.9-nightly.785-macos-arm64.tar.gz"
      sha256 "f6b7f0bc8020dd84c63daa06ef13fc634cf5bcdf292df582b08df32323f77eb4"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.785/Dovo-Server-Nightly-0.0.9-nightly.785-linux-arm64.tar.gz"
      sha256 "6be5dc91cc447d61aeee48234dd3dea9eab93b92c1120dffc48892d676edab8c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.785/Dovo-Server-Nightly-0.0.9-nightly.785-linux-x64.tar.gz"
      sha256 "6e1c8b473176602e4f388eaa08030545eca5c54859ef4e9f47a5d20da38bf53c"
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
