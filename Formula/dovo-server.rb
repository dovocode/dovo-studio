class DovoServer < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.2"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.2/Dovo-Server-0.0.2-macos-arm64.tar.gz"
      sha256 "2d01d117145819aafb6fcaf3442e192771ccdf1ff10d52b8b28fa20b07c71e16"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.2/Dovo-Server-0.0.2-linux-arm64.tar.gz"
      sha256 "8b659b951b6a24409c1cde256cb12bf66c36d3e5cae7270688317ea0cec147cf"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.2/Dovo-Server-0.0.2-linux-x64.tar.gz"
      sha256 "3daf352d109298ddcc687fd69e274444fc5d9c639c318222e5d4ccbc4aa3246f"
    end
  end
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/dovo-server"
  end
  def caveats
    <<~EOS
      Configure: dovo-server setup
      Start:     dovo-server start
      Pair:      dovo-server pair
      Finish active work and stop before upgrading, then start again.
      Data is stored in ~/.dovo by default and is never removed by uninstall.
      This formula does not register an automatic login service.
    EOS
  end
  test do
    assert_match "Usage:", shell_output("#{bin}/dovo-server --help")
  end
end
