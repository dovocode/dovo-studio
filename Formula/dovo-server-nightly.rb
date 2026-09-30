class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.109"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.109/Dovo-Server-Nightly-0.0.7-nightly.109-macos-arm64.tar.gz"
      sha256 "fd98c7d5e11e99aba893f72c9b761f06d54c8ed575fad087c0424e26dbdfda80"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.109/Dovo-Server-Nightly-0.0.7-nightly.109-linux-arm64.tar.gz"
      sha256 "3d931a826c41b25ac6b0fca2601f5070f7208d9ece341cda31d22641057ad1f3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.109/Dovo-Server-Nightly-0.0.7-nightly.109-linux-x64.tar.gz"
      sha256 "dcf9139038516f01d940abf1446728b2c506a6c570f572eca4b0f6c074c59197"
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
