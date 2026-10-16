class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.361"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.361/Dovo-Server-Nightly-0.0.9-nightly.361-macos-arm64.tar.gz"
      sha256 "585e3fc1bef09dcbaa7c983f2ec9678cecff7d58ca29e1095cb47ef5dedc0e25"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.361/Dovo-Server-Nightly-0.0.9-nightly.361-linux-arm64.tar.gz"
      sha256 "1d2c5146cdbfa110ab57fb989ece50f2feb5ece798ecbbc6acf90c413aa05783"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.361/Dovo-Server-Nightly-0.0.9-nightly.361-linux-x64.tar.gz"
      sha256 "34565166c9323248c96f6e09a2de01dbb70539bf1a2c0bf9a45cca5de44f63d3"
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
