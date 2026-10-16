class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.347"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.347/Dovo-Server-Nightly-0.0.9-nightly.347-macos-arm64.tar.gz"
      sha256 "a30e0abbf7099eefe5967d99f4c8aa3dd37ff45a3e6d929a19e3db8ec9ee8f09"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.347/Dovo-Server-Nightly-0.0.9-nightly.347-linux-arm64.tar.gz"
      sha256 "e6d36cd61463ead249c18f1253db9f66fca4ed70d1159149cfc75677e4f6f55c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.347/Dovo-Server-Nightly-0.0.9-nightly.347-linux-x64.tar.gz"
      sha256 "d38883eb4e87fa34cb6daded3ceede111b7ecffc1a9f0319f9df1e8ef70e8159"
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
