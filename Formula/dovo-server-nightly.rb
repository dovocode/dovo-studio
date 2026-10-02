class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.165"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.165/Dovo-Server-Nightly-0.0.7-nightly.165-macos-arm64.tar.gz"
      sha256 "6b2a46b13f8c3b4094dafb1390dbaf0ac85151c5c64d7a4bf6a1cf0f852df103"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.165/Dovo-Server-Nightly-0.0.7-nightly.165-linux-arm64.tar.gz"
      sha256 "52f64e89d3713081b26e3b47aa9f821e3649072b4b4fbc1018b25caf9d6e9dac"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.165/Dovo-Server-Nightly-0.0.7-nightly.165-linux-x64.tar.gz"
      sha256 "06f88f4f40de1978ba38d57e3dda8c33e63199c53e9c297a3c4c4f7dcf51068b"
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
