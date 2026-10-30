class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.593"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.593/Dovo-Server-Nightly-0.0.9-nightly.593-macos-arm64.tar.gz"
      sha256 "a9d4c6007f9b74b9341a8786baf8d30037642be79746f8e348fd84feb28b5fcc"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.593/Dovo-Server-Nightly-0.0.9-nightly.593-linux-arm64.tar.gz"
      sha256 "1384661212345b21bb0983127df673bee4e7120604f65f0cd4de30db0f9bfbef"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.593/Dovo-Server-Nightly-0.0.9-nightly.593-linux-x64.tar.gz"
      sha256 "624e08358b731e84966caac44761b146f455e65a8f6d14344882900841d56c2f"
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
