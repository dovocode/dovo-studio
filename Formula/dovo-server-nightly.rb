class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.142"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.142/Dovo-Server-Nightly-0.0.7-nightly.142-macos-arm64.tar.gz"
      sha256 "82530546ea4c384395eddcd6cdca349c589d8e0bedfeca0d07ae6d62481c94a1"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.142/Dovo-Server-Nightly-0.0.7-nightly.142-linux-arm64.tar.gz"
      sha256 "56746c10d19593f5f3528b4673ab04d083a8bf9db7c8bb08b94b7dd91f5c6f8c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.142/Dovo-Server-Nightly-0.0.7-nightly.142-linux-x64.tar.gz"
      sha256 "d0d4d160996391a906e9909a530447450ab9bfc1d8532c5164e17702be0640e4"
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
