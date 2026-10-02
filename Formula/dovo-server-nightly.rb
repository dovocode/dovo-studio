class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.156"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.156/Dovo-Server-Nightly-0.0.7-nightly.156-macos-arm64.tar.gz"
      sha256 "249c2b5b760d267ef492514ffa944eed32ca493a04e31d3fa8124d4e34d1aee6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.156/Dovo-Server-Nightly-0.0.7-nightly.156-linux-arm64.tar.gz"
      sha256 "472769b607f9e0a25234bb508ee412e327f171506e35ed6970364a610a1b3a9f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.156/Dovo-Server-Nightly-0.0.7-nightly.156-linux-x64.tar.gz"
      sha256 "f5ebf36ef1e8e76233235745c7bc532303b5f382e54666c28868a9749f4a8ecf"
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
