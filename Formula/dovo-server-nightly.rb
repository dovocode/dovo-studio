class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.145"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.145/Dovo-Server-Nightly-0.0.7-nightly.145-macos-arm64.tar.gz"
      sha256 "b9d96b31872d02271245fff87bdcb2aae987e861b60bfba01bf7e1b9974ffc0f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.145/Dovo-Server-Nightly-0.0.7-nightly.145-linux-arm64.tar.gz"
      sha256 "ce753db5cb2cd93a3c3fa24858f6f028151d85f504fd94ec39f6da233efa32c5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.145/Dovo-Server-Nightly-0.0.7-nightly.145-linux-x64.tar.gz"
      sha256 "e488e7d0301ec8d343fefbd196c3e650736871d0075e7d23effb1d83ace6a684"
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
