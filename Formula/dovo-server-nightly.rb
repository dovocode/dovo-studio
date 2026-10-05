class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.221"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.221/Dovo-Server-Nightly-0.0.7-nightly.221-macos-arm64.tar.gz"
      sha256 "e2afd98b47ef44f298a07f522f04ff64daa5a9df34bef5ed144467c17d4b072a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.221/Dovo-Server-Nightly-0.0.7-nightly.221-linux-arm64.tar.gz"
      sha256 "1cf6b9178422ddd9a483158cdcf8b00d1a3761e8b114e3bd2b4e0ec9f61f364a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.221/Dovo-Server-Nightly-0.0.7-nightly.221-linux-x64.tar.gz"
      sha256 "8ec4671ba0247caffa7c1785ef82b823a70af5162d4fb0aa11e0b7380cfb9100"
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
