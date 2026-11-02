class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.647"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.647/Dovo-Server-Nightly-0.0.9-nightly.647-macos-arm64.tar.gz"
      sha256 "c656410e0ad5ec55f550ef331407331ee226403f5cf25c9c4c1b0dbfa8fe485b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.647/Dovo-Server-Nightly-0.0.9-nightly.647-linux-arm64.tar.gz"
      sha256 "06c76ee516a149cc0972435f63be877000136a63bec606aa165a9e91343a1c71"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.647/Dovo-Server-Nightly-0.0.9-nightly.647-linux-x64.tar.gz"
      sha256 "83a6aa3913aad3ac1a6ff165cad6340074c3f5bf00d5d25e5c0f031da05e237a"
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
