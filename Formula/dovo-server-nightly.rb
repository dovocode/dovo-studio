class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.747"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.747/Dovo-Server-Nightly-0.0.9-nightly.747-macos-arm64.tar.gz"
      sha256 "f8c53b586671f874bb02528a394b073e6528cff2b8c17ee189cb123959a8f71b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.747/Dovo-Server-Nightly-0.0.9-nightly.747-linux-arm64.tar.gz"
      sha256 "ff20f96da5c3eacaace18b7ec1c14e3b05603256c86c6bc21f6422a3ad7feded"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.747/Dovo-Server-Nightly-0.0.9-nightly.747-linux-x64.tar.gz"
      sha256 "67a3dac9a64705166c114ca9104edb3987643154fa611c1b3b4d9869c70ed027"
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
