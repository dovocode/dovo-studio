class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.155"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.155/Dovo-Server-Nightly-0.0.7-nightly.155-macos-arm64.tar.gz"
      sha256 "779568817b695c80f9eab3bee6696318fe1ee31d86b75143972b4457ad3ce88e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.155/Dovo-Server-Nightly-0.0.7-nightly.155-linux-arm64.tar.gz"
      sha256 "30993ef62c87dae5df2bcf43cf967d51ea9aeb418fcb0d9ed038a7cb6bcce8ac"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.155/Dovo-Server-Nightly-0.0.7-nightly.155-linux-x64.tar.gz"
      sha256 "a9240d0887d48e289e8b25334c63c593395a5a417c8cde30ca37aa7915a4a9a3"
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
