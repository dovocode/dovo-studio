class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.301"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.301/Dovo-Server-Nightly-0.0.9-nightly.301-macos-arm64.tar.gz"
      sha256 "8b4c49305b565bceed4b8b5bf92cdf3653e22101f05cddbce4f993d612b539fe"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.301/Dovo-Server-Nightly-0.0.9-nightly.301-linux-arm64.tar.gz"
      sha256 "fc181927fac0b4026dad9eaa5d2dc8c91a4373aa8026ad2744e593dfcddf419b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.301/Dovo-Server-Nightly-0.0.9-nightly.301-linux-x64.tar.gz"
      sha256 "bb953410bb4270bc7852e352faf628ffafad2401e9aa4d2481b4141a12e58f22"
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
