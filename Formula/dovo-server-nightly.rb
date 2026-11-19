class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.980"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.980/Dovo-Server-Nightly-0.0.9-nightly.980-macos-arm64.tar.gz"
      sha256 "524c2b788fdf5fcf201abe171c770c7aa2aef93c3c89f77b344cf99333476bbd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.980/Dovo-Server-Nightly-0.0.9-nightly.980-linux-arm64.tar.gz"
      sha256 "0e0ba587de923745b7f9e48701f88caab2fa19e530a02bee730249292376cae1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.980/Dovo-Server-Nightly-0.0.9-nightly.980-linux-x64.tar.gz"
      sha256 "d00dccc3a7ba11e728d57f4ff88273a9abc17c96db889de915e51ffc2d7093bc"
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
