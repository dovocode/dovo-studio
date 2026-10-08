class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.254"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.254/Dovo-Server-Nightly-0.0.9-nightly.254-macos-arm64.tar.gz"
      sha256 "f30b54680bbd88b2e2bacb929b61c7549c83c9ef70812d165d7e9002e29c14a2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.254/Dovo-Server-Nightly-0.0.9-nightly.254-linux-arm64.tar.gz"
      sha256 "091da1cfee299d977799209b79025c5e4d1afd2ff21dfeb53344c077208c3ba0"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.254/Dovo-Server-Nightly-0.0.9-nightly.254-linux-x64.tar.gz"
      sha256 "cbfcfe230b07b53c6488209a88d09ea0ff17e359132c5f8fa62d20ed225179ed"
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
