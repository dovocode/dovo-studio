class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.214"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.214/Dovo-Server-Nightly-0.0.7-nightly.214-macos-arm64.tar.gz"
      sha256 "6a3f10243efb51d6d4c6cb184a3fe2efa232857dcdf045d0a7ce5b5d1eb61570"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.214/Dovo-Server-Nightly-0.0.7-nightly.214-linux-arm64.tar.gz"
      sha256 "3303c9f9e07a3cde886cb14c9f6b219ef09e5905740c892ee849ce9555513074"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.214/Dovo-Server-Nightly-0.0.7-nightly.214-linux-x64.tar.gz"
      sha256 "fb74e9f420ddd553d00e415c4471e63b1ad6eb6d33b78a5920b7a28839c84645"
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
