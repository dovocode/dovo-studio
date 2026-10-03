class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.190"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.190/Dovo-Server-Nightly-0.0.7-nightly.190-macos-arm64.tar.gz"
      sha256 "7ca435e75ceb694af1187e0b059135284777521a72fd426002b5a458463e89b1"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.190/Dovo-Server-Nightly-0.0.7-nightly.190-linux-arm64.tar.gz"
      sha256 "a61fe7c7285323ea6b5b8fc66f40349b5a3345c0a108428e7735fe498a406e18"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.190/Dovo-Server-Nightly-0.0.7-nightly.190-linux-x64.tar.gz"
      sha256 "56317235e8d85d9b865ceb52854dfee362b1b931349d0e501114ab42b6840a8a"
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
