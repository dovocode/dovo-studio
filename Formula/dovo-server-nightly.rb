class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.125"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.125/Dovo-Server-Nightly-0.0.7-nightly.125-macos-arm64.tar.gz"
      sha256 "9d4e010ca9b7b43b02f3813bc56a9c64aafb736b4c75136a9d1bd97312ba0119"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.125/Dovo-Server-Nightly-0.0.7-nightly.125-linux-arm64.tar.gz"
      sha256 "10bd6e3fa81f2a386d3de9fd0224d9a8708f2a7a3b0b0c4505471c5a7eada730"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.125/Dovo-Server-Nightly-0.0.7-nightly.125-linux-x64.tar.gz"
      sha256 "b852dfbf3f58f2154baff53b11956f83e1d8a4459109c8774994667245f54442"
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
