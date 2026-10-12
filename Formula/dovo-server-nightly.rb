class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.288"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.288/Dovo-Server-Nightly-0.0.9-nightly.288-macos-arm64.tar.gz"
      sha256 "a40b28467c7d77f214d5475f4d3afb716ea93fc63f030edd2eadf7aa811cb542"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.288/Dovo-Server-Nightly-0.0.9-nightly.288-linux-arm64.tar.gz"
      sha256 "71c621cc3777d2921b051001b6310813ad54b84038485fe1bbbde8b7245cb0eb"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.288/Dovo-Server-Nightly-0.0.9-nightly.288-linux-x64.tar.gz"
      sha256 "484fd8d1db0617dfdeeffbc2d9f7a9986ac626999b1ac02fd76099b88060d1be"
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
