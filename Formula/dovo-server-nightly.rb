class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.62"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.62/Dovo-Server-Nightly-0.0.7-nightly.62-macos-arm64.tar.gz"
      sha256 "63b7e02a75cb6ee7b52ea988597b1b815df87bb09effd0b99fbc81d6e5213658"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.62/Dovo-Server-Nightly-0.0.7-nightly.62-linux-arm64.tar.gz"
      sha256 "28cb458d8e07fd4b36b1341ca3efd05ebbbd845e732bde32a92c226eae19f276"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.62/Dovo-Server-Nightly-0.0.7-nightly.62-linux-x64.tar.gz"
      sha256 "2056b6b5d7051963a01b4550f11c75133d1c535b974238904d6eb282b28d41e9"
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
