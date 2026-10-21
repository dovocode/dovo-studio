class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.431"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.431/Dovo-Server-Nightly-0.0.9-nightly.431-macos-arm64.tar.gz"
      sha256 "e69d3d8ab0ec921d7478e91914a113209e1185c4c5e63270766f2e53e09c6d14"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.431/Dovo-Server-Nightly-0.0.9-nightly.431-linux-arm64.tar.gz"
      sha256 "6787b260173bb8982361bfc50b4f49b5f63ebaefb5d54f29fe30696d10b63aca"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.431/Dovo-Server-Nightly-0.0.9-nightly.431-linux-x64.tar.gz"
      sha256 "c879cfecbe8d3ce86deb221dd0b69f1c618ad9a62924208fd0363e4954769072"
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
