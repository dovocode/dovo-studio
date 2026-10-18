class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.384"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.384/Dovo-Server-Nightly-0.0.9-nightly.384-macos-arm64.tar.gz"
      sha256 "120e41ba3fac8a3210da96e55803407fc4a3ce173feac48ed4631c08f975977b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.384/Dovo-Server-Nightly-0.0.9-nightly.384-linux-arm64.tar.gz"
      sha256 "4d7f53396d6cce3da1c7c55c8a4913a78768d1c839e60b95faf8ce85e4b3414e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.384/Dovo-Server-Nightly-0.0.9-nightly.384-linux-x64.tar.gz"
      sha256 "3a4a5257ca56a1256191a8262b19843f124e58e3d2e7f0397d4c6d4f8e071411"
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
