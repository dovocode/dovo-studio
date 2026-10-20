class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.417"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.417/Dovo-Server-Nightly-0.0.9-nightly.417-macos-arm64.tar.gz"
      sha256 "4e0382e911e6e352646ab9e5b9c1449ab4b13524a985ae0463c1f3096417a441"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.417/Dovo-Server-Nightly-0.0.9-nightly.417-linux-arm64.tar.gz"
      sha256 "05a3bafbff3b8990c552fa1b46e9d0d9a9a1dc1cccdc5e1d404e6d56b66c8f58"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.417/Dovo-Server-Nightly-0.0.9-nightly.417-linux-x64.tar.gz"
      sha256 "122311ca8da978729d54778cc40d48137ba98edbd370daeb21319ee9cb7a16b8"
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
