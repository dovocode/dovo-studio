class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.973"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.973/Dovo-Server-Nightly-0.0.9-nightly.973-macos-arm64.tar.gz"
      sha256 "068b3ef5f4f45497e32f061f9ac8cd89a1b12e9d07c990204409b8a569f60801"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.973/Dovo-Server-Nightly-0.0.9-nightly.973-linux-arm64.tar.gz"
      sha256 "ec9aed15cdd1d5184e99a1d7a39dad3935b76907f190309291c79d2cac4a6219"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.973/Dovo-Server-Nightly-0.0.9-nightly.973-linux-x64.tar.gz"
      sha256 "eb5b5f3273cafdbebb3ca7f6cf9928e026add3e19c43dd48caafcee8233383f9"
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
