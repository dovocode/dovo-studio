class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.380"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.380/Dovo-Server-Nightly-0.0.9-nightly.380-macos-arm64.tar.gz"
      sha256 "7b9c4e00497efb49929217ec3f8268667de55b9f9f4e7e47122d4684b2a63e50"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.380/Dovo-Server-Nightly-0.0.9-nightly.380-linux-arm64.tar.gz"
      sha256 "ffc6d0c50a3d03654683f4f468981ed00c07705cee97dce7ed54d5e675e30e75"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.380/Dovo-Server-Nightly-0.0.9-nightly.380-linux-x64.tar.gz"
      sha256 "9f50c0df63affd39640ac32e25ff78ec06da6773fb83635a33aaba122919d1af"
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
