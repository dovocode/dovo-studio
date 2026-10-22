class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.465"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.465/Dovo-Server-Nightly-0.0.9-nightly.465-macos-arm64.tar.gz"
      sha256 "ba44b899625bb308b2d06a991eab53124bbb988ff4efc627743e45803f4cfa5b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.465/Dovo-Server-Nightly-0.0.9-nightly.465-linux-arm64.tar.gz"
      sha256 "5de9924a8667550ea4acda5c04b6c649e174151b4d9cf749e489a5e00ad63e66"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.465/Dovo-Server-Nightly-0.0.9-nightly.465-linux-x64.tar.gz"
      sha256 "34b15efaa7cc332b5760f1fdab39ea3c10b4d13c077156e021019a6fab19262f"
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
