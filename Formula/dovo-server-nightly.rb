class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.208"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.208/Dovo-Server-Nightly-0.0.7-nightly.208-macos-arm64.tar.gz"
      sha256 "95d8856826923acd38044c7476b6fee1bf99def01ce9b8f7358649d0c6e4470c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.208/Dovo-Server-Nightly-0.0.7-nightly.208-linux-arm64.tar.gz"
      sha256 "68c9510158664ae61ad8f4f794f54968e0eee4420ebbf81496f766198bdf6f13"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.208/Dovo-Server-Nightly-0.0.7-nightly.208-linux-x64.tar.gz"
      sha256 "8ea5f4dfb8a6f595c1b5e03d0c64847e57f04163e7a786602b5be907591d4799"
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
