class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.642"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.642/Dovo-Server-Nightly-0.0.9-nightly.642-macos-arm64.tar.gz"
      sha256 "7662c2f692540cc37a713394696ba8bab412aa2336d739bc6684edc9707f570a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.642/Dovo-Server-Nightly-0.0.9-nightly.642-linux-arm64.tar.gz"
      sha256 "bd4c1792c96348070abcb3d2488adcae8b6dbb5210071497f95305252acce911"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.642/Dovo-Server-Nightly-0.0.9-nightly.642-linux-x64.tar.gz"
      sha256 "9bae071415b02287edcc4bd05d7350a8673024aa5b9c95f1fd32f83c3018616c"
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
