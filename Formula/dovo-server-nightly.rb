class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1067"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1067/Dovo-Server-Nightly-0.0.9-nightly.1067-macos-arm64.tar.gz"
      sha256 "49fb348c6c066f83e8e63fe7614afef787e2d40fecd745554ced872ccd817cc2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1067/Dovo-Server-Nightly-0.0.9-nightly.1067-linux-arm64.tar.gz"
      sha256 "30168018485719b64ec0cbd99867be0267539d06c5b6595a539aec382cb4a1a3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1067/Dovo-Server-Nightly-0.0.9-nightly.1067-linux-x64.tar.gz"
      sha256 "a9ede95654d6036dc2d9ef965464610d61293949600d8cd04303abbd1c72b571"
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
