class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.124"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.124/Dovo-Server-Nightly-0.0.7-nightly.124-macos-arm64.tar.gz"
      sha256 "51ad9fe4bceba49c30ca95ba35de3bbcd67cf21820a92b613d3a5733d1af4ffd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.124/Dovo-Server-Nightly-0.0.7-nightly.124-linux-arm64.tar.gz"
      sha256 "c6568a5d5ffa6ab23ff79ff28cc9cc215ede6f656c2ece8c33bfa5c4d6929cf1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.124/Dovo-Server-Nightly-0.0.7-nightly.124-linux-x64.tar.gz"
      sha256 "2291991b6d8b3913f326c8f80c25fe7fa3bdab54feca3bc3c823c9bb3b974a89"
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
