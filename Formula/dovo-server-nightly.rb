class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.65"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.65/Dovo-Server-Nightly-0.0.7-nightly.65-macos-arm64.tar.gz"
      sha256 "bb9941c4257dc7aa39e33e20becd5ce4de09ddf2fae12d330ce39478dd84ad52"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.65/Dovo-Server-Nightly-0.0.7-nightly.65-linux-arm64.tar.gz"
      sha256 "da931dbbb1a7ddf86bedbe77456b38ab2f8554f113c9d187ce2cbc007645daa1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.65/Dovo-Server-Nightly-0.0.7-nightly.65-linux-x64.tar.gz"
      sha256 "7cc6c4685875a750bf7dc5b9146a28475682344e20687c3f7e197e50b2e3427a"
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
