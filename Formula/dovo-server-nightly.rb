class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.222"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.222/Dovo-Server-Nightly-0.0.7-nightly.222-macos-arm64.tar.gz"
      sha256 "3c67477db9145a3add5143cb8ca97ee843e8a1f05e23e6240c3350e5bc68bf37"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.222/Dovo-Server-Nightly-0.0.7-nightly.222-linux-arm64.tar.gz"
      sha256 "de32b6a41dfb98b7a0d4ae1068d44314f9590b1ff14aea4edd228ffe2c0ad744"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.222/Dovo-Server-Nightly-0.0.7-nightly.222-linux-x64.tar.gz"
      sha256 "be88f6fa8404ab7814900ce33496cda4f29c6cfe9f7eab7bcd490ae497175d13"
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
