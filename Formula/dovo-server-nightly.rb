class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.895"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.895/Dovo-Server-Nightly-0.0.9-nightly.895-macos-arm64.tar.gz"
      sha256 "e40100b8c0da83002bff8fe0370c77fbb3190f67fd11178b41690b627b8e90a6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.895/Dovo-Server-Nightly-0.0.9-nightly.895-linux-arm64.tar.gz"
      sha256 "9707f7583683adfd629cf01addbc3a1fb60df6412984f3fc52c7ae2b0b62887f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.895/Dovo-Server-Nightly-0.0.9-nightly.895-linux-x64.tar.gz"
      sha256 "5704392db10db335696a3e2a88b46b0977ecf1e97cf9d5d949f71ebb21e4a048"
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
