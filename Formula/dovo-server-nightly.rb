class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.28"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.28/Dovo-Server-Nightly-0.0.7-nightly.28-macos-arm64.tar.gz"
      sha256 "72aa93ca03c586659d371bdf2e11b7b1ac6f124f0f2fc5a1af66cad6ee6232ce"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.28/Dovo-Server-Nightly-0.0.7-nightly.28-linux-arm64.tar.gz"
      sha256 "5663b5e92b3976633621d91752eac95bc2395e1c587afbcb21e8136b716ef722"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.28/Dovo-Server-Nightly-0.0.7-nightly.28-linux-x64.tar.gz"
      sha256 "d08f17dd1316f2846af380960f79cef1e778d962f251fde9f199fecbf61a30d7"
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
