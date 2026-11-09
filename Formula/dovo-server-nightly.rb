class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.753"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.753/Dovo-Server-Nightly-0.0.9-nightly.753-macos-arm64.tar.gz"
      sha256 "4ba3b58f4de4780bda8cd1b82bd0fb08eee067d1126d0ee8c09a3358f84c7017"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.753/Dovo-Server-Nightly-0.0.9-nightly.753-linux-arm64.tar.gz"
      sha256 "3eb3d7ad171f6bb0b9dcc9c335b14c420642c86c1f2199b055e457d7b2557113"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.753/Dovo-Server-Nightly-0.0.9-nightly.753-linux-x64.tar.gz"
      sha256 "b3e74d013db55c4cd9e939a694a0e63c04c519ff2be82a128b09fef4a4f3a826"
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
