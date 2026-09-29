class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.54"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.54/Dovo-Server-Nightly-0.0.7-nightly.54-macos-arm64.tar.gz"
      sha256 "98e98765096aa2603c6bafd73fcdf6223cf25fdc381d38e33faaf346a7993dd0"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.54/Dovo-Server-Nightly-0.0.7-nightly.54-linux-arm64.tar.gz"
      sha256 "9482e4fdf844014ddc8b27673d3dee207c36b1617fa46709f3bfa5b5368af9a8"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.54/Dovo-Server-Nightly-0.0.7-nightly.54-linux-x64.tar.gz"
      sha256 "bea57ebed919ce2e6ec3d39a0778a7e1cfb5a8a6b33e4f21447a58250ffa9276"
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
