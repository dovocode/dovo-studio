class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.201"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.201/Dovo-Server-Nightly-0.0.7-nightly.201-macos-arm64.tar.gz"
      sha256 "a4cebe650e05c4d8a901aa4ae9d98ab58561b1661b6a4f1c17b80cc5cefb0430"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.201/Dovo-Server-Nightly-0.0.7-nightly.201-linux-arm64.tar.gz"
      sha256 "eda25a21cf28f173724761601a731de73d00d74f2dd52c4b12de2683a346f23c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.201/Dovo-Server-Nightly-0.0.7-nightly.201-linux-x64.tar.gz"
      sha256 "9cf89814075a7526b405987e33e7b115513c16d103f8100536dbbce76cc3f404"
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
