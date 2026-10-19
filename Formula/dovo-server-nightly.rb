class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.405"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.405/Dovo-Server-Nightly-0.0.9-nightly.405-macos-arm64.tar.gz"
      sha256 "dd66bd13e232ec1b6696948c5668d1bd8d1aa6482303f2d8501f7ed2fa6a39d6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.405/Dovo-Server-Nightly-0.0.9-nightly.405-linux-arm64.tar.gz"
      sha256 "0926bd5f3399f13719b71c1945b7ed779fc1599fe47de9eb23b423317a102787"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.405/Dovo-Server-Nightly-0.0.9-nightly.405-linux-x64.tar.gz"
      sha256 "bb607a307dff9485aba75158da28c59cc587dcae867b36ba1550bd8c6f691ae6"
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
