class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.856"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.856/Dovo-Server-Nightly-0.0.9-nightly.856-macos-arm64.tar.gz"
      sha256 "17627d30956826ed3d7ea27f0ac47ac2fed2836da78894bdadd6fd950c79788a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.856/Dovo-Server-Nightly-0.0.9-nightly.856-linux-arm64.tar.gz"
      sha256 "e9338bd251a9a9f7735373af7b7bbd693e27c7370d5580f86c3d141989b9fa68"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.856/Dovo-Server-Nightly-0.0.9-nightly.856-linux-x64.tar.gz"
      sha256 "981a60546444c86ae19c534601ef7cfb3409ce7ba008928e9d20a8191bd3a1e2"
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
