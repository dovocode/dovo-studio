class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.303"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.303/Dovo-Server-Nightly-0.0.9-nightly.303-macos-arm64.tar.gz"
      sha256 "965e059f509b5646734c82f488e5f0070763c8ff5405c4df8742a38e7d2428d2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.303/Dovo-Server-Nightly-0.0.9-nightly.303-linux-arm64.tar.gz"
      sha256 "105d02ac8af8e7a4fcea728fb55f1ff765e204d38cd9b5545db37951be020d6c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.303/Dovo-Server-Nightly-0.0.9-nightly.303-linux-x64.tar.gz"
      sha256 "531fa1d99b18be0c469d1734e4859459513df69a1af6c95f2b0831d244ac17da"
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
