class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1123"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1123/Dovo-Server-Nightly-0.0.9-nightly.1123-macos-arm64.tar.gz"
      sha256 "5c3c2949a3a3eae415c7091923f56890d7b8604ef880d400d53eebf892b9b586"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1123/Dovo-Server-Nightly-0.0.9-nightly.1123-linux-arm64.tar.gz"
      sha256 "568d176035afcbb64859c22add9d0b82542ea047af0e49997d3a82f7637ac697"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1123/Dovo-Server-Nightly-0.0.9-nightly.1123-linux-x64.tar.gz"
      sha256 "dd1948bcc18cbc056ab94c701ac5771bfe0c47fd9d3026a46158a16fa700e532"
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
