class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.611"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.611/Dovo-Server-Nightly-0.0.9-nightly.611-macos-arm64.tar.gz"
      sha256 "4772f669dcd6f3c1f935c8e2e74a0565ed944cdabd1ead212525437ce9bcdbc8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.611/Dovo-Server-Nightly-0.0.9-nightly.611-linux-arm64.tar.gz"
      sha256 "8c80fdd6eccefa96fd1d26fbebea9f68fe47aa090d6f0e8c05d2eba2856c0a51"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.611/Dovo-Server-Nightly-0.0.9-nightly.611-linux-x64.tar.gz"
      sha256 "ded5f48b8440059544e151c34b0671830a08ea5aed749cffa8a37536c1315690"
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
