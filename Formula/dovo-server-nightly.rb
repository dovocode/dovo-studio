class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.697"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.697/Dovo-Server-Nightly-0.0.9-nightly.697-macos-arm64.tar.gz"
      sha256 "2e984488dc69861a4d206fd2f62a9b735d855c4ce694563edd7be46232cc5d9a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.697/Dovo-Server-Nightly-0.0.9-nightly.697-linux-arm64.tar.gz"
      sha256 "9aab7f1c8b7b8cfe8e1703a90d241ffc7bdd2e2f32dadc14eedf7ef22a80c9a6"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.697/Dovo-Server-Nightly-0.0.9-nightly.697-linux-x64.tar.gz"
      sha256 "6d2234f1506d8cb0268d2a082eda1144a00d0c6508e6c999ae065a40d772e47c"
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
