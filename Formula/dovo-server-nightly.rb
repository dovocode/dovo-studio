class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.777"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.777/Dovo-Server-Nightly-0.0.9-nightly.777-macos-arm64.tar.gz"
      sha256 "9073897bfb4893471df2c61b9333713bf1f49064355c6d85c744deba6d92e741"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.777/Dovo-Server-Nightly-0.0.9-nightly.777-linux-arm64.tar.gz"
      sha256 "6842668a8e7da9350e9faca51c844b1321011ea4e5b262704dc0aa1416fe5f71"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.777/Dovo-Server-Nightly-0.0.9-nightly.777-linux-x64.tar.gz"
      sha256 "a2777ee1f7afb5b29dd7ccdf1a44340c108ef4db507115a13997b737fc34974b"
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
