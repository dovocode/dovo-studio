class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.920"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.920/Dovo-Server-Nightly-0.0.9-nightly.920-macos-arm64.tar.gz"
      sha256 "1c404b4f655b5a49a99050fc13e0ad578537e934ad12a56831cab7b1607bd1a0"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.920/Dovo-Server-Nightly-0.0.9-nightly.920-linux-arm64.tar.gz"
      sha256 "a6083242a10de4471217d3c317fa3e390c671d46f6ce5d1c436c670dd01ef493"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.920/Dovo-Server-Nightly-0.0.9-nightly.920-linux-x64.tar.gz"
      sha256 "f4885b0ea9522e9e5f65acaf61e3d56207ab340d480f508084b0769d978fa9eb"
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
