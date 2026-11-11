class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.793"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.793/Dovo-Server-Nightly-0.0.9-nightly.793-macos-arm64.tar.gz"
      sha256 "c9a2ca914e739df525b96e37ff146e561610f102a3c71158e1b96e4d682a9394"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.793/Dovo-Server-Nightly-0.0.9-nightly.793-linux-arm64.tar.gz"
      sha256 "16a8e320f027cd1d71850f88eac5b6a2aced147c8d715fbe42db2acbfff60214"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.793/Dovo-Server-Nightly-0.0.9-nightly.793-linux-x64.tar.gz"
      sha256 "fbd7eb3c8a31cf65c2cf77ee4b21a12f19a2430640024478b6b80e1135d3e953"
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
