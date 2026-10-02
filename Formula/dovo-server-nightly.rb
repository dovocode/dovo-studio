class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.149"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.149/Dovo-Server-Nightly-0.0.7-nightly.149-macos-arm64.tar.gz"
      sha256 "3fe09e210450fac1dc52a1dac83b568ff6fcf6d71c1fa0331ebd88a028dd9754"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.149/Dovo-Server-Nightly-0.0.7-nightly.149-linux-arm64.tar.gz"
      sha256 "d645f989e847652631b778eab531a3fbb54680d8d79e0b157e58c45d67f878ac"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.149/Dovo-Server-Nightly-0.0.7-nightly.149-linux-x64.tar.gz"
      sha256 "8ad3be8c364317be62a43a7b366236e44321df446e36a034208043ce1763a120"
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
