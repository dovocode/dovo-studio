class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.117"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.117/Dovo-Server-Nightly-0.0.7-nightly.117-macos-arm64.tar.gz"
      sha256 "1a68fe0cc8a6b9515ff5fdb7141b9add2ccf71ffe4211bd4b991e6497b7c07a2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.117/Dovo-Server-Nightly-0.0.7-nightly.117-linux-arm64.tar.gz"
      sha256 "9b6dd3c56b4bac25087ea3e0a746ece99934bf3d7595d9e55e8260a25ff69f96"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.117/Dovo-Server-Nightly-0.0.7-nightly.117-linux-x64.tar.gz"
      sha256 "898386a9b220c4af8227a35039811e85133642c13e68d71f263455f7206eb3dd"
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
