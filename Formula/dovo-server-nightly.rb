class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.131"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.131/Dovo-Server-Nightly-0.0.7-nightly.131-macos-arm64.tar.gz"
      sha256 "03df2030c2e37df0a02298605b57b5086d408515cbb43d69b903a5a088f52584"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.131/Dovo-Server-Nightly-0.0.7-nightly.131-linux-arm64.tar.gz"
      sha256 "ab7fea0de46da1e31d6674b2da0a7c85e411b321d2ac21e2849cdb76bd7db4a6"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.131/Dovo-Server-Nightly-0.0.7-nightly.131-linux-x64.tar.gz"
      sha256 "5ddf7e5f785c8f0876b0af336e7159da90d44cd841d21574a71e345b28066a8b"
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
