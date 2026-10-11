class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.279"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.279/Dovo-Server-Nightly-0.0.9-nightly.279-macos-arm64.tar.gz"
      sha256 "dd2ac13b0fb99a6c4f5298ce140869fc3cfe135a2e9d29b4db6cae04c788dbae"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.279/Dovo-Server-Nightly-0.0.9-nightly.279-linux-arm64.tar.gz"
      sha256 "f66b88404aed8b0df3be6b57da007b7116c722a7aad950c9d80b51fb53b34f17"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.279/Dovo-Server-Nightly-0.0.9-nightly.279-linux-x64.tar.gz"
      sha256 "2a94a7c9a9dfdadae6f2d7c78204516e3f1e6da7a9ac1894e64e17a56098f1a6"
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
