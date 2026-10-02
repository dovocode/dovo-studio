class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.171"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.171/Dovo-Server-Nightly-0.0.7-nightly.171-macos-arm64.tar.gz"
      sha256 "887c3296a0295e425fc2cdd291eac18cf5ac885d043345ecc5caca0d9fda5deb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.171/Dovo-Server-Nightly-0.0.7-nightly.171-linux-arm64.tar.gz"
      sha256 "795a69e21e63fbbc4e0bfb35adae470a08b13df0a0afaa5c1899051b50e954e3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.171/Dovo-Server-Nightly-0.0.7-nightly.171-linux-x64.tar.gz"
      sha256 "d877f957bfe3cd7fc837cf8164604a0d45b7c3c7a3bf84f644b08b6497fcdb4b"
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
