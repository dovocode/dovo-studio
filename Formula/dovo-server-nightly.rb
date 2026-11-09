class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.750"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.750/Dovo-Server-Nightly-0.0.9-nightly.750-macos-arm64.tar.gz"
      sha256 "c8a051e51ba3bc9b2ee175b985bd86f601d7777f0701aa8ab543948460597afd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.750/Dovo-Server-Nightly-0.0.9-nightly.750-linux-arm64.tar.gz"
      sha256 "0db8cd559d0c9843848bef94b35c032da658f08b33de0880ac182b5f5d82ce6c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.750/Dovo-Server-Nightly-0.0.9-nightly.750-linux-x64.tar.gz"
      sha256 "658772dc4b12b8bcb3c4839952b91c28467e2b61cd676b30f8015603b23997cd"
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
