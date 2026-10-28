class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.554"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.554/Dovo-Server-Nightly-0.0.9-nightly.554-macos-arm64.tar.gz"
      sha256 "0955d6793a3d1a6a29bd394db04b25b7c7e93966272abc8d366e09219aa6e950"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.554/Dovo-Server-Nightly-0.0.9-nightly.554-linux-arm64.tar.gz"
      sha256 "fc11e008693497c3230fe9112b8bb497de78b280194ef1ff60eea3585ca58f16"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.554/Dovo-Server-Nightly-0.0.9-nightly.554-linux-x64.tar.gz"
      sha256 "5ccdf7ecaa8baf09bce05237832380a5b9e76728d5041e588ab23471d50de383"
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
