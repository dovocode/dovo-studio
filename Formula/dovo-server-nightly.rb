class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1071"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1071/Dovo-Server-Nightly-0.0.9-nightly.1071-macos-arm64.tar.gz"
      sha256 "4f06825eb5f9801002380933c800f6947285bc37136dad3ca689605b82d5e1ef"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1071/Dovo-Server-Nightly-0.0.9-nightly.1071-linux-arm64.tar.gz"
      sha256 "4ad2bdcfe6b75ee3333961ff6be995d80c7504fa8cbe01ea2e4a7bf5b6890c01"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1071/Dovo-Server-Nightly-0.0.9-nightly.1071-linux-x64.tar.gz"
      sha256 "34d1ffc26e2eee3c4aa3dc41aeb6e4450b158646e09ac9613f2c4a834fd90ae8"
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
