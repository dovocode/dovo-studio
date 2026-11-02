class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.663"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.663/Dovo-Server-Nightly-0.0.9-nightly.663-macos-arm64.tar.gz"
      sha256 "e9e2cc0bbe6650af1f75243b910ccdc190b851fb01edde7c4b75b1df9e04bd12"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.663/Dovo-Server-Nightly-0.0.9-nightly.663-linux-arm64.tar.gz"
      sha256 "560872f6e8a06214d63480715b8af1d3ee279beaa167b790db48db21f284cf42"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.663/Dovo-Server-Nightly-0.0.9-nightly.663-linux-x64.tar.gz"
      sha256 "ea8841756a951f88c3c5137f34a226347b9d085820d41d97df53f61d606a3ab5"
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
