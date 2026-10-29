class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.588"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.588/Dovo-Server-Nightly-0.0.9-nightly.588-macos-arm64.tar.gz"
      sha256 "fa516547beedf8fd8a69b4e0b231a1e69ec0ed900ddda448e261c50318969052"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.588/Dovo-Server-Nightly-0.0.9-nightly.588-linux-arm64.tar.gz"
      sha256 "7ab30424c2ed45322ac59970d692213d12bda201d120ab5356b9ac86a9201de5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.588/Dovo-Server-Nightly-0.0.9-nightly.588-linux-x64.tar.gz"
      sha256 "cd73fad93b8df51602684555b068334a0b9b889d5522f5e2e654a27c8191cd9c"
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
