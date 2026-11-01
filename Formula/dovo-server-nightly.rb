class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.625"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.625/Dovo-Server-Nightly-0.0.9-nightly.625-macos-arm64.tar.gz"
      sha256 "14141665d3ce3b64113d4aaf7d4aaa73da290f05185be25888af759fa2422eec"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.625/Dovo-Server-Nightly-0.0.9-nightly.625-linux-arm64.tar.gz"
      sha256 "930f163df9f08aeb2acf6e3bf1368c519efc30afb994235d4cb17b1f8e34567a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.625/Dovo-Server-Nightly-0.0.9-nightly.625-linux-x64.tar.gz"
      sha256 "7a21c42fc57b1d10acd817601aac14522e217017485b9ea204cd5a0549080973"
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
