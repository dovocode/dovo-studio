class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.324"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.324/Dovo-Server-Nightly-0.0.9-nightly.324-macos-arm64.tar.gz"
      sha256 "06208472b93d4f0f4d88a636d3a4cb52ca8e58c3f49c3683fa98ddaa6c23f1a9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.324/Dovo-Server-Nightly-0.0.9-nightly.324-linux-arm64.tar.gz"
      sha256 "390e249d5e8b1aed410ab2f906f169d4cc3b8d134b21b38f732040dc0e880db3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.324/Dovo-Server-Nightly-0.0.9-nightly.324-linux-x64.tar.gz"
      sha256 "3c5d2b48967c6e4d35e8a4987af22447696797185db9e3e8b8babf356ceb5444"
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
