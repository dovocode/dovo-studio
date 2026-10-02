class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.161"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.161/Dovo-Server-Nightly-0.0.7-nightly.161-macos-arm64.tar.gz"
      sha256 "a8e6044a797d14336dd30f9b4a37d1767092dea98cb64943f957425db5b9120a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.161/Dovo-Server-Nightly-0.0.7-nightly.161-linux-arm64.tar.gz"
      sha256 "8cfa1ebb6f8e1dd188f9aade99b15beb24932f5d273c233cb07290e67c76585b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.161/Dovo-Server-Nightly-0.0.7-nightly.161-linux-x64.tar.gz"
      sha256 "a1f827d14c2a998bdc2c936ae91ecfe1af64d61216942882d6c4d9c8ef6679bb"
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
