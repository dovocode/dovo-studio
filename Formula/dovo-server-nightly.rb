class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.907"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.907/Dovo-Server-Nightly-0.0.9-nightly.907-macos-arm64.tar.gz"
      sha256 "c8f27c99954e9f756594c8704f92d5c3b3c95bcc893127617c43886ee00e9167"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.907/Dovo-Server-Nightly-0.0.9-nightly.907-linux-arm64.tar.gz"
      sha256 "ca8c66e43aa5cb7468089a87d68a0b4eb18fa19fa51b27221e2c30632e1625a0"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.907/Dovo-Server-Nightly-0.0.9-nightly.907-linux-x64.tar.gz"
      sha256 "a39135f3ddaad8c1f9b30626c108f20d98436fdf9548e09890689223fb6b2196"
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
