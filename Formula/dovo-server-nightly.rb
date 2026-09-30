class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.99"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.99/Dovo-Server-Nightly-0.0.7-nightly.99-macos-arm64.tar.gz"
      sha256 "df87b6a13cc4b3d5a23157181e5d68150a91bbdfa553d2f8ef8e4d3af3e16211"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.99/Dovo-Server-Nightly-0.0.7-nightly.99-linux-arm64.tar.gz"
      sha256 "db8c940745a7e12132f7abc9fcedd66b169d86f8fc6d0d77d104a2cfcde2a50e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.99/Dovo-Server-Nightly-0.0.7-nightly.99-linux-x64.tar.gz"
      sha256 "084ee5439cfb25faba2f9da828dff5e02525d443fe3d18f73b36038871ab779d"
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
