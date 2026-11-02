class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.653"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.653/Dovo-Server-Nightly-0.0.9-nightly.653-macos-arm64.tar.gz"
      sha256 "0924a2fc2e3f1451672b21e3ce9d2f53f85029c34a22d21005c65a7378507f4a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.653/Dovo-Server-Nightly-0.0.9-nightly.653-linux-arm64.tar.gz"
      sha256 "a7fc04ddc04e96fd0024a721a362283c289ef374610049df1f2b94f82fdf75ed"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.653/Dovo-Server-Nightly-0.0.9-nightly.653-linux-x64.tar.gz"
      sha256 "34d7c788b37221ab3cfb21a1401333aaa53c92f095f791334d9749455937d2a6"
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
