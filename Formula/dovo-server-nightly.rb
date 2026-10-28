class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.575"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.575/Dovo-Server-Nightly-0.0.9-nightly.575-macos-arm64.tar.gz"
      sha256 "686f1e11d0bce84a1a0da5c3114c5131dd453cbb13eea5bf0f6b2ed34e0ddfd2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.575/Dovo-Server-Nightly-0.0.9-nightly.575-linux-arm64.tar.gz"
      sha256 "9d3726e97e2f2e184d2d927daf364b72d9052a9dcc14e29ffba6034cfc459983"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.575/Dovo-Server-Nightly-0.0.9-nightly.575-linux-x64.tar.gz"
      sha256 "9d861ab01b73943e23ba206baebb406cdca9cda51618cf658f26be969f92a411"
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
