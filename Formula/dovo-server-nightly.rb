class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.371"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.371/Dovo-Server-Nightly-0.0.9-nightly.371-macos-arm64.tar.gz"
      sha256 "d5fc3621613370b926d512ab0ef8a627daa1b10d0c97489187e23d9e169001cb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.371/Dovo-Server-Nightly-0.0.9-nightly.371-linux-arm64.tar.gz"
      sha256 "f045c47197976c691fb476942ea5a518c9c1e716477659adcbf502e076efe797"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.371/Dovo-Server-Nightly-0.0.9-nightly.371-linux-x64.tar.gz"
      sha256 "21b5331a9a03bb4555a1d333f406e9035e186b7040bcbafc07b528543e0c68b3"
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
