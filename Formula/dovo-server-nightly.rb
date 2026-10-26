class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.519"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.519/Dovo-Server-Nightly-0.0.9-nightly.519-macos-arm64.tar.gz"
      sha256 "0798900e1f24496a468cc737748d43f35f2667e0995a9d07ff7fc6e86eea01d9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.519/Dovo-Server-Nightly-0.0.9-nightly.519-linux-arm64.tar.gz"
      sha256 "18810ed1a843faffd99bf356543d137e6c88f0e48d88d361bade81c4563ef1e2"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.519/Dovo-Server-Nightly-0.0.9-nightly.519-linux-x64.tar.gz"
      sha256 "58d33e2bfbba05d0ea79f1533e8dd79493feb953f428561e0aed0e5f6fd5ae0f"
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
