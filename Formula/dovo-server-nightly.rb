class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1049"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1049/Dovo-Server-Nightly-0.0.9-nightly.1049-macos-arm64.tar.gz"
      sha256 "e651e71e8b6a56d242625a87f61a53718a472fa5d6e62a215036252aecd59237"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1049/Dovo-Server-Nightly-0.0.9-nightly.1049-linux-arm64.tar.gz"
      sha256 "361b722ef0060b7112afeadc5c4af880d0bf9dbb360e39ce6ff58f5a9dd5475c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1049/Dovo-Server-Nightly-0.0.9-nightly.1049-linux-x64.tar.gz"
      sha256 "adea36ca6c4b4c2fa2519038b991422a8702023e82ed500e8754bba8c9f41680"
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
