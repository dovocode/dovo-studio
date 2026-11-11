class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.815"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.815/Dovo-Server-Nightly-0.0.9-nightly.815-macos-arm64.tar.gz"
      sha256 "9b7b8319285d100502df12bac265a681a45f263d1e1bebb9be56b11f3328cbb2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.815/Dovo-Server-Nightly-0.0.9-nightly.815-linux-arm64.tar.gz"
      sha256 "d258667cf8af3c49f855441c33985f7516a9f0c3a98bd390c0df41fdcbe61546"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.815/Dovo-Server-Nightly-0.0.9-nightly.815-linux-x64.tar.gz"
      sha256 "bd9b2fc21c932b0454a2215000e37986c8fb4bd8957770831c4af44ffcf53379"
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
