class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.677"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.677/Dovo-Server-Nightly-0.0.9-nightly.677-macos-arm64.tar.gz"
      sha256 "b21103fe8136f805d0e0cc3e2042d589ba9f65b3c7cc8977c116e847a1fb0f45"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.677/Dovo-Server-Nightly-0.0.9-nightly.677-linux-arm64.tar.gz"
      sha256 "e444a36d4a40ddf10cee509a9d80777ebcc61703e83dc3aada0ebaea0c4be8db"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.677/Dovo-Server-Nightly-0.0.9-nightly.677-linux-x64.tar.gz"
      sha256 "83854d02272ea81f250d72fecdaf309fe6e5d16c07dc4251a23500e9b7f0a066"
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
