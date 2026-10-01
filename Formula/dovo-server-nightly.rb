class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.130"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.130/Dovo-Server-Nightly-0.0.7-nightly.130-macos-arm64.tar.gz"
      sha256 "263ba41e401b931cc2250b464ae41bcf0af04d8cbfbc6637be8ec158868990a7"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.130/Dovo-Server-Nightly-0.0.7-nightly.130-linux-arm64.tar.gz"
      sha256 "eda1c19c7a06ccbbe2cd1cbf48667cf047fa8ee85cbc01b1d1b8e5bcce06b969"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.130/Dovo-Server-Nightly-0.0.7-nightly.130-linux-x64.tar.gz"
      sha256 "c607ecbc7204a671f1837122ae2a026b72f3125d81bddc88d7dbe48e31bbb1a5"
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
