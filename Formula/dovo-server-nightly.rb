class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.64"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.64/Dovo-Server-Nightly-0.0.7-nightly.64-macos-arm64.tar.gz"
      sha256 "068c81991ec8df255274e079a5021bdd82611cfe9314ef517f50b4217cc14b2b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.64/Dovo-Server-Nightly-0.0.7-nightly.64-linux-arm64.tar.gz"
      sha256 "174b8d4613dcb57196061fec5a2ca58979c2a49d1d98dc95886d6a262703d2bb"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.64/Dovo-Server-Nightly-0.0.7-nightly.64-linux-x64.tar.gz"
      sha256 "7ac12387dc4de3ec10fc329e5d00051fd3fefbd0d5d29106357486c494458c89"
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
