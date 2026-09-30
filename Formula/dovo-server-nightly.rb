class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.93"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.93/Dovo-Server-Nightly-0.0.7-nightly.93-macos-arm64.tar.gz"
      sha256 "0a42e4b276ae1f478e6456dd4459574ba1199d21030d3c9dc487a9c2a7353fe9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.93/Dovo-Server-Nightly-0.0.7-nightly.93-linux-arm64.tar.gz"
      sha256 "2c093d79ebc9d79d9339b29ad78fbe454e05cbcf3503af2fa3390ff3904e8db8"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.93/Dovo-Server-Nightly-0.0.7-nightly.93-linux-x64.tar.gz"
      sha256 "a8602ca4923e26016682fcd0abbaa4520ec55daa920c08dff76c48358377b883"
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
