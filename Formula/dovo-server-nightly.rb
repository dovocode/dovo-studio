class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.175"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.175/Dovo-Server-Nightly-0.0.7-nightly.175-macos-arm64.tar.gz"
      sha256 "c73a15b66043232187b8f9fb7ae02b5dab94a13ad3262d86de0decc23387b49d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.175/Dovo-Server-Nightly-0.0.7-nightly.175-linux-arm64.tar.gz"
      sha256 "463c14dfd92b52b60a9c3966b203e04929a71278e9b473cc2a2dcee0bc3e6708"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.175/Dovo-Server-Nightly-0.0.7-nightly.175-linux-x64.tar.gz"
      sha256 "c05e3019d626b18e323abeaec30cc714b2a0cf599d18d915e3556d60b0788f3d"
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
