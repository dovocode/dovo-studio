class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.176"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.176/Dovo-Server-Nightly-0.0.7-nightly.176-macos-arm64.tar.gz"
      sha256 "1a233e661a0f09ee69066fcd3346011233c1087b9f47fa3e2ad56ab34b25585d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.176/Dovo-Server-Nightly-0.0.7-nightly.176-linux-arm64.tar.gz"
      sha256 "d2c4dae1eb4886b115ce15a54ccd519c8a4aa67e054d68333772c60f6931e6de"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.176/Dovo-Server-Nightly-0.0.7-nightly.176-linux-x64.tar.gz"
      sha256 "77509109420d13704d65af787a90039af07871f9203a1acb9cdfe84ee328143e"
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
