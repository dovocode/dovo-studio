class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.76"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.76/Dovo-Server-Nightly-0.0.7-nightly.76-macos-arm64.tar.gz"
      sha256 "a046d5ec76d58f6cf6131faefaee7099ed72c2c6e2c6ebacb70fb65622b28a15"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.76/Dovo-Server-Nightly-0.0.7-nightly.76-linux-arm64.tar.gz"
      sha256 "100474607fce0dc69289afd92eb5a1433d95987a52c429b2b81bfc387dc4c74c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.76/Dovo-Server-Nightly-0.0.7-nightly.76-linux-x64.tar.gz"
      sha256 "0a44126e50f3a26318939840fa853819d9c071675a25f8cd8738e513257dbc35"
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
