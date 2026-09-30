class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.79"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.79/Dovo-Server-Nightly-0.0.7-nightly.79-macos-arm64.tar.gz"
      sha256 "3f5645fd9b6b09bd76168265e9c1d95e20eb361527f0175b693e00530c45874f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.79/Dovo-Server-Nightly-0.0.7-nightly.79-linux-arm64.tar.gz"
      sha256 "c0853bb0e68cc981402e45e5734e79a991259d77512c3ebee90cec01800b2711"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.79/Dovo-Server-Nightly-0.0.7-nightly.79-linux-x64.tar.gz"
      sha256 "ea1d1feff3093c37f70430c6d4b06183657fc2570414607db81d0f6db8138ea6"
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
