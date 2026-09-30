class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.91"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.91/Dovo-Server-Nightly-0.0.7-nightly.91-macos-arm64.tar.gz"
      sha256 "589a79f79a5b0c273bc93770fad1c4e9eb09a652f793a9fceeca209e0fb0c226"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.91/Dovo-Server-Nightly-0.0.7-nightly.91-linux-arm64.tar.gz"
      sha256 "b2d449e4dd05fdde26440006ca69c8dd0197e3c285112ef2224a2d06a9a3bcc9"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.91/Dovo-Server-Nightly-0.0.7-nightly.91-linux-x64.tar.gz"
      sha256 "b8d75a46b47a55a0fbe4bc32786b31b644b9e28ac7fccb9be8eef31309febbef"
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
