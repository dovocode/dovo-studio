class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1098"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1098/Dovo-Server-Nightly-0.0.9-nightly.1098-macos-arm64.tar.gz"
      sha256 "9e8ba1da3015a82fe0fa5ed89630ed3294a5b6e12ded960f306e28e6a3e16587"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1098/Dovo-Server-Nightly-0.0.9-nightly.1098-linux-arm64.tar.gz"
      sha256 "faa7fad5d4ff8cde2901fb30e06ea5ddc214a4786137f542aea092f2a7dc9e47"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1098/Dovo-Server-Nightly-0.0.9-nightly.1098-linux-x64.tar.gz"
      sha256 "6dfd1bcefebc6dd76e4742cb7fd02085cc0b8b60d9cf0190ead295eb1f7f3c87"
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
