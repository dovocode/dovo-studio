class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.878"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.878/Dovo-Server-Nightly-0.0.9-nightly.878-macos-arm64.tar.gz"
      sha256 "aec101cec55b8185214ee6209ee20add24ec0983a451e3a238033778ee5ecb71"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.878/Dovo-Server-Nightly-0.0.9-nightly.878-linux-arm64.tar.gz"
      sha256 "1a9fd8adc2d3269f3c5cf4e6ae76400f7aedb835b5e97add419a2d2cf0e093d5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.878/Dovo-Server-Nightly-0.0.9-nightly.878-linux-x64.tar.gz"
      sha256 "587136a223a5d7165d3d8c76a147278ee544d9ed876c9ca499ee239ebb843c6f"
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
