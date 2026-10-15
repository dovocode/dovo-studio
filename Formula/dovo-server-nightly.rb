class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.334"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.334/Dovo-Server-Nightly-0.0.9-nightly.334-macos-arm64.tar.gz"
      sha256 "449159784a77b75a417dd30e72c1dc09af975858698eeeef85b8b4e34c7ddd35"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.334/Dovo-Server-Nightly-0.0.9-nightly.334-linux-arm64.tar.gz"
      sha256 "c844fa9a2afc6da146a53d78b7d87703f33ee0aa6849209575149f503f44ce9f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.334/Dovo-Server-Nightly-0.0.9-nightly.334-linux-x64.tar.gz"
      sha256 "8d83039ef05510276d691a3891f41c60ca62aaf7bed8dbaa980ee84a5374e68e"
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
