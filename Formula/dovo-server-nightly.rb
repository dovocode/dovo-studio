class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.29"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.29/Dovo-Server-Nightly-0.0.7-nightly.29-macos-arm64.tar.gz"
      sha256 "8dc0ad7ab3dfc9b711a810709d90fa1405e6e3f4a8a6ef915edb86ea17982f79"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.29/Dovo-Server-Nightly-0.0.7-nightly.29-linux-arm64.tar.gz"
      sha256 "fb976bb01d8fbff13ffaae78cd86f6de24dd487712ada42dec5460e51b080def"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.29/Dovo-Server-Nightly-0.0.7-nightly.29-linux-x64.tar.gz"
      sha256 "303c470860ae9fc7fa290e79c6c76737f507d93897780206a1e8c9509e20aa57"
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
