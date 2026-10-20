class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.407"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.407/Dovo-Server-Nightly-0.0.9-nightly.407-macos-arm64.tar.gz"
      sha256 "b485a83ee3301b00d7be3575700b7405d2b8134efea604b087b8b8fc84cf446c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.407/Dovo-Server-Nightly-0.0.9-nightly.407-linux-arm64.tar.gz"
      sha256 "a2463215441fc426b751b3acc7d6346882d9ae71c123a3deaf7c73d47af79577"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.407/Dovo-Server-Nightly-0.0.9-nightly.407-linux-x64.tar.gz"
      sha256 "70206b2fd26f11642f13282d517e68dcd1ea68d8d64c693e15eda49ec7e3ff9d"
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
