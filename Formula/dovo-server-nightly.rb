class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.633"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.633/Dovo-Server-Nightly-0.0.9-nightly.633-macos-arm64.tar.gz"
      sha256 "673d7374a536b267575adadc7c87dea9745031b95a17081372dad8fcd7d20f1f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.633/Dovo-Server-Nightly-0.0.9-nightly.633-linux-arm64.tar.gz"
      sha256 "174008af8cca2a3129e0add60f5dabf52ace67775436151ac990e7cc97229901"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.633/Dovo-Server-Nightly-0.0.9-nightly.633-linux-x64.tar.gz"
      sha256 "9d645563c2dd9adce1de3bb869b47f82ee2c0b654e5ec625eedc13f0b301ee25"
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
