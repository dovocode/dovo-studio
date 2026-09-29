class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.61"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.61/Dovo-Server-Nightly-0.0.7-nightly.61-macos-arm64.tar.gz"
      sha256 "e9aa3a1444da84391e04932e302af07f981f1f3c369a3f838d61f73207dfa3cb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.61/Dovo-Server-Nightly-0.0.7-nightly.61-linux-arm64.tar.gz"
      sha256 "8723c8e307bbb486a34d73a98d50e409dde4f821224420981cafb4cc3da7e1bc"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.61/Dovo-Server-Nightly-0.0.7-nightly.61-linux-x64.tar.gz"
      sha256 "65ddd38233dbf02b0500cd72f1832a2fa6b536786efdf0138a81e74a22ab9a7a"
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
