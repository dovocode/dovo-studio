class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.454"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.454/Dovo-Server-Nightly-0.0.9-nightly.454-macos-arm64.tar.gz"
      sha256 "cd38e050eaaa7d2aa03793c03be6ac98c980457df239d0a236cba3c14db48ade"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.454/Dovo-Server-Nightly-0.0.9-nightly.454-linux-arm64.tar.gz"
      sha256 "c2fcbe7e23bd5b692e45cc1aa168625483000a33bb8ff7b47888dca0b2713d85"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.454/Dovo-Server-Nightly-0.0.9-nightly.454-linux-x64.tar.gz"
      sha256 "3fec1f130e8d9960f9f2c13e788cdc8e4f99f20d5cad440a48393bcb98a11f21"
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
