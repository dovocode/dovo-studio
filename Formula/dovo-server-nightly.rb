class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.623"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.623/Dovo-Server-Nightly-0.0.9-nightly.623-macos-arm64.tar.gz"
      sha256 "4b3d28f6ba38236000ee30e75b6308605dce825cb302eb9d5e230958358cfb4b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.623/Dovo-Server-Nightly-0.0.9-nightly.623-linux-arm64.tar.gz"
      sha256 "ad418e4302cf0fee6c6bb4d839ac835cc6e0c5aa3352334de2b71099936c3941"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.623/Dovo-Server-Nightly-0.0.9-nightly.623-linux-x64.tar.gz"
      sha256 "7461ae7cba51cda45ac5612ce48eaa29f970ce52535d49c11f118693fdc4af3d"
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
