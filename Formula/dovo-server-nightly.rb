class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.114"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.114/Dovo-Server-Nightly-0.0.7-nightly.114-macos-arm64.tar.gz"
      sha256 "6c6b664ddb266ccea888d806f1578925176ce552e06b685e9a387b04f0de9a2f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.114/Dovo-Server-Nightly-0.0.7-nightly.114-linux-arm64.tar.gz"
      sha256 "436ea1a593880d59fec4776b28213f3b9edbf75715d87647db3337316720248f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.114/Dovo-Server-Nightly-0.0.7-nightly.114-linux-x64.tar.gz"
      sha256 "7d541dd2f76d14e127e7f18ab26810b642c4d49ef59e2cdd572b0e555722aaa7"
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
