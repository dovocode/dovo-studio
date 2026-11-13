class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.876"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.876/Dovo-Server-Nightly-0.0.9-nightly.876-macos-arm64.tar.gz"
      sha256 "2870f13287c1383194d04f0e377124a66274cd16c8d2be200f761ca26e26f438"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.876/Dovo-Server-Nightly-0.0.9-nightly.876-linux-arm64.tar.gz"
      sha256 "0b48ae4c2cb116b623fe1577aae3faa58a21a0aea75ac606b11cb45c1794d04e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.876/Dovo-Server-Nightly-0.0.9-nightly.876-linux-x64.tar.gz"
      sha256 "bc8d8e83b6e863dd0dd652f60768cff3605673d5ee095f6222c58bdc00a0d56f"
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
