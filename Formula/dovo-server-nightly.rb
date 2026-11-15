class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.891"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.891/Dovo-Server-Nightly-0.0.9-nightly.891-macos-arm64.tar.gz"
      sha256 "bdcf1707b79570ac93de3fc5939f7a4f9aab992db551832d59dae317c665a35b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.891/Dovo-Server-Nightly-0.0.9-nightly.891-linux-arm64.tar.gz"
      sha256 "38e9936b780e3025bfe65f99f70c7157fcd55a6544ec4dcf52010fe720c51a42"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.891/Dovo-Server-Nightly-0.0.9-nightly.891-linux-x64.tar.gz"
      sha256 "094bc8891e71c1e54adca80a9a58f0baff91dc50286415f6f93a314dd797e3e2"
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
