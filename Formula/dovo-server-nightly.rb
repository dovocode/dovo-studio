class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.858"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.858/Dovo-Server-Nightly-0.0.9-nightly.858-macos-arm64.tar.gz"
      sha256 "2cbdf57b8607a9d932e71b6779d303b006e85062373c209e1bcb96c226e5aa6b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.858/Dovo-Server-Nightly-0.0.9-nightly.858-linux-arm64.tar.gz"
      sha256 "d901b347d4510bf9c9bc0a9d30c3cdf61c0e275d2cb4efebefd414adf96b2a66"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.858/Dovo-Server-Nightly-0.0.9-nightly.858-linux-x64.tar.gz"
      sha256 "d44bae785f169b70ecc90705305dddb8df15803c4baf6705883805dffe014368"
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
