class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.695"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.695/Dovo-Server-Nightly-0.0.9-nightly.695-macos-arm64.tar.gz"
      sha256 "6ecf4d892a4489bff941a5c344b5b90f0e32c2b86885a7156bc1836b10416ca5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.695/Dovo-Server-Nightly-0.0.9-nightly.695-linux-arm64.tar.gz"
      sha256 "ccf42b36d7c08293dc79982ac81e5800f6337a42c3451be008d70adaabc73c0c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.695/Dovo-Server-Nightly-0.0.9-nightly.695-linux-x64.tar.gz"
      sha256 "facaaf48d93b1236fd2bda725cd525c2c8a9d675e682e14a13eefa8cc005a779"
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
