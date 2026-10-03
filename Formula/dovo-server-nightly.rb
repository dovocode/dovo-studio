class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.184"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.184/Dovo-Server-Nightly-0.0.7-nightly.184-macos-arm64.tar.gz"
      sha256 "debc9611bfca75969180ae7b5b90ba77d5570322bb0c79c408c08e1fa261a704"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.184/Dovo-Server-Nightly-0.0.7-nightly.184-linux-arm64.tar.gz"
      sha256 "2a7ba5cdf69ee907e46f792adfcf9475e17d21551c866ae54a8ac9ec2b957412"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.184/Dovo-Server-Nightly-0.0.7-nightly.184-linux-x64.tar.gz"
      sha256 "82c85c017d09c9f56ab7ca363fe8e4ccc06b85eb353e94178efa719941c5f2f7"
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
