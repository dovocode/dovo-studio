class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.166"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.166/Dovo-Server-Nightly-0.0.7-nightly.166-macos-arm64.tar.gz"
      sha256 "5ef88aebab8b49ff33c009b17d3028861c7c6338e2a6325df77bd054af319508"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.166/Dovo-Server-Nightly-0.0.7-nightly.166-linux-arm64.tar.gz"
      sha256 "25c7a35128df6eb4ea3954917d97512717cf1dba5f424082c5646a77d49ebc2b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.166/Dovo-Server-Nightly-0.0.7-nightly.166-linux-x64.tar.gz"
      sha256 "f93d52fbe86b6c79a82e87831fbaea5d3d905f26f448c2f5a9a4d3676767a217"
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
