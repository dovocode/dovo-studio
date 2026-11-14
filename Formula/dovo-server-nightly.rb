class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.880"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.880/Dovo-Server-Nightly-0.0.9-nightly.880-macos-arm64.tar.gz"
      sha256 "c0d37b35f159ea57502775ceb686a4048088eea6f2ad17dda6940428d5c08452"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.880/Dovo-Server-Nightly-0.0.9-nightly.880-linux-arm64.tar.gz"
      sha256 "5a8aec623ac9c99cc40a337a48b0cdf192d09be76c25b241e98d5d71f5f86e0c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.880/Dovo-Server-Nightly-0.0.9-nightly.880-linux-x64.tar.gz"
      sha256 "3f23b02ee983b9fa5e6385c244d139618152ff28ad3134c703d82f8a59ea3ec3"
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
