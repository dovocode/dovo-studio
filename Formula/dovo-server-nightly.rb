class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.771"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.771/Dovo-Server-Nightly-0.0.9-nightly.771-macos-arm64.tar.gz"
      sha256 "d5ec9310c8fb7005ee632de3c7cffc4659a3594d02e91d5802e9fdd468972b51"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.771/Dovo-Server-Nightly-0.0.9-nightly.771-linux-arm64.tar.gz"
      sha256 "5a526ce549c8dfc6f5f3560fbc5da89a58d6a86168c92bac772c6cc7afc35288"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.771/Dovo-Server-Nightly-0.0.9-nightly.771-linux-x64.tar.gz"
      sha256 "551f1db55d9814d01e4b445035ea6a5d3ee35fc48d77b9ae6bba0a303db0dda6"
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
