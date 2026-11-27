class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1117"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1117/Dovo-Server-Nightly-0.0.9-nightly.1117-macos-arm64.tar.gz"
      sha256 "96cd18dbdfea55e82248dfa270f2db9ab6422a3a8f507da1772ab3563fd7e628"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1117/Dovo-Server-Nightly-0.0.9-nightly.1117-linux-arm64.tar.gz"
      sha256 "934f8be16572d38ff8820f27d3fe140e87e6babfd96101334881369609d219b1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1117/Dovo-Server-Nightly-0.0.9-nightly.1117-linux-x64.tar.gz"
      sha256 "fb024a7fd034e7210bd88112c4ae871558f47b4edef6db18978141b69fc6e521"
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
