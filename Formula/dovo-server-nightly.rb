class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.243"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.243/Dovo-Server-Nightly-0.0.9-nightly.243-macos-arm64.tar.gz"
      sha256 "a9fbda44b2f7e9f638a2228c61133742070230c2b47d6c486cc5101ea7e253f7"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.243/Dovo-Server-Nightly-0.0.9-nightly.243-linux-arm64.tar.gz"
      sha256 "b1b4bfd81b5c20ce20190061a2f2bd2635817446262dd2d8720eef08260f3720"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.243/Dovo-Server-Nightly-0.0.9-nightly.243-linux-x64.tar.gz"
      sha256 "2285189579e869706675a27942c5d794798844d9cfecf06e20cfafdb2a119eb0"
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
