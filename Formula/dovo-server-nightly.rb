class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.916"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.916/Dovo-Server-Nightly-0.0.9-nightly.916-macos-arm64.tar.gz"
      sha256 "db2d0e428944cd11255f897e55a5fbf493e597fe106fb8bc27a2656da25b30bd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.916/Dovo-Server-Nightly-0.0.9-nightly.916-linux-arm64.tar.gz"
      sha256 "4f2eb91af80fe45b0d9446a1d957cf4e3be866c839d44057d8060b6f39c7d496"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.916/Dovo-Server-Nightly-0.0.9-nightly.916-linux-x64.tar.gz"
      sha256 "3f44a7584b809298ec0aa9712c23812706d937602795b7d1b402e83927d00b8b"
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
