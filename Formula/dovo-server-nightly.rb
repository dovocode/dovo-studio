class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.249"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.249/Dovo-Server-Nightly-0.0.9-nightly.249-macos-arm64.tar.gz"
      sha256 "570632c0de2d0a05ca1041e71cac2fc9cf619e41c2304183f8baf5015090cd89"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.249/Dovo-Server-Nightly-0.0.9-nightly.249-linux-arm64.tar.gz"
      sha256 "e9596f26ed72fbe3eeb9b760324928a30988fba53113263e0789c2e5f7f27bee"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.249/Dovo-Server-Nightly-0.0.9-nightly.249-linux-x64.tar.gz"
      sha256 "78828525090305aa3ad02a2f562491497d47986ef49953ef32adf0b220e7d9b6"
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
