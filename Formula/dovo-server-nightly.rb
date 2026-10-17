class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.368"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.368/Dovo-Server-Nightly-0.0.9-nightly.368-macos-arm64.tar.gz"
      sha256 "fc4b218d54ae378cc4bfcc101b94f7357c131bf7ba8802b9b0607bc86ba3d195"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.368/Dovo-Server-Nightly-0.0.9-nightly.368-linux-arm64.tar.gz"
      sha256 "74afaf172526edfbc942facb0969a13d7f61e98c11d3387a9c4b0f9b96e1b3ff"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.368/Dovo-Server-Nightly-0.0.9-nightly.368-linux-x64.tar.gz"
      sha256 "0252761966e19e3a93b13e8dbd21d6d37c54192283c5d21b64bbe6d3dbf7e6fd"
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
