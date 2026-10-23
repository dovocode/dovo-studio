class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.476"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.476/Dovo-Server-Nightly-0.0.9-nightly.476-macos-arm64.tar.gz"
      sha256 "4e4dcf87d6ab88786b6a1de6c09485ffb36c98033ab6c59fc5ba73711eb1ed6d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.476/Dovo-Server-Nightly-0.0.9-nightly.476-linux-arm64.tar.gz"
      sha256 "b39676203ce4db50d293448f849b066d4cad9e149f542f28575837cc99b11187"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.476/Dovo-Server-Nightly-0.0.9-nightly.476-linux-x64.tar.gz"
      sha256 "5d9231144729cf232eb44824b350de3011364148e8938fc31bfe6c3fb213f512"
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
