class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.139"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.139/Dovo-Server-Nightly-0.0.7-nightly.139-macos-arm64.tar.gz"
      sha256 "969c134101964fc4723bb185efa66522a301f7f4b40f61044513cbeb5301a9f1"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.139/Dovo-Server-Nightly-0.0.7-nightly.139-linux-arm64.tar.gz"
      sha256 "50ce87b1f3ce028eb613f5e98daefebef5c6a1b38e20cb0370a2db8907356c08"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.139/Dovo-Server-Nightly-0.0.7-nightly.139-linux-x64.tar.gz"
      sha256 "13669766d3935472116e7ebdf2c128593fef715ac28a4702533492a50c6a0d43"
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
