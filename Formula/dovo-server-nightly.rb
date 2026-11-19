class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.978"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.978/Dovo-Server-Nightly-0.0.9-nightly.978-macos-arm64.tar.gz"
      sha256 "c8c537a977bee97108bc207d52eba4afd47cdece663c3e0308711bd72d229fbb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.978/Dovo-Server-Nightly-0.0.9-nightly.978-linux-arm64.tar.gz"
      sha256 "dec662299abeb5aa7f83d41d0c1ca3789e883369ec5f75641d45b5a880298cb0"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.978/Dovo-Server-Nightly-0.0.9-nightly.978-linux-x64.tar.gz"
      sha256 "ae85fe7f5baf742116d774bf5fb8c49816f30247f8c18ffa02082e0b91641a23"
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
