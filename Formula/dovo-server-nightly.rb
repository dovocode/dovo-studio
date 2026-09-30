class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.104"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.104/Dovo-Server-Nightly-0.0.7-nightly.104-macos-arm64.tar.gz"
      sha256 "0f901c8e116bbcd3965f091f019bdc98726f49fa5a24cb1f54f5873825b4579a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.104/Dovo-Server-Nightly-0.0.7-nightly.104-linux-arm64.tar.gz"
      sha256 "ff166889b4c9ce62822e9e1370bfc68715d3b9a54b4e6dd194a19fb3b55532b5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.104/Dovo-Server-Nightly-0.0.7-nightly.104-linux-x64.tar.gz"
      sha256 "1957d83af600f599ab98620277dac308bf4a53b396c9a126a12870420c4e69d0"
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
