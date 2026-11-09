class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.759"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.759/Dovo-Server-Nightly-0.0.9-nightly.759-macos-arm64.tar.gz"
      sha256 "4a6b9f952d0d05d890f5c3d15bcf25ddc2bf80f48716bf71f73fbb12e5fc2eda"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.759/Dovo-Server-Nightly-0.0.9-nightly.759-linux-arm64.tar.gz"
      sha256 "b5a3f49ff5b445809e8fc946213e18acfef72bbff42f4b1e9b86efd3a33d06bc"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.759/Dovo-Server-Nightly-0.0.9-nightly.759-linux-x64.tar.gz"
      sha256 "32270246408a91a2312a48e1702b1a4ee696560780feeae14c9525266e9ce9d3"
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
