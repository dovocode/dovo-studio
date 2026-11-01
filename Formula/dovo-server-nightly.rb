class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.629"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.629/Dovo-Server-Nightly-0.0.9-nightly.629-macos-arm64.tar.gz"
      sha256 "373c26cf840f588a1a0c4bca500196d1f6cc99cca60ef68e0e0e4c31513cc7c6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.629/Dovo-Server-Nightly-0.0.9-nightly.629-linux-arm64.tar.gz"
      sha256 "276dead95743c50fc05548599aa47e236f8f95daa1b78d7b248269fde52b2b9b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.629/Dovo-Server-Nightly-0.0.9-nightly.629-linux-x64.tar.gz"
      sha256 "9ea754a07142411c6d8277829ccbf1ddedb9a0f65e34ade130d664887730608e"
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
