class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.78"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.78/Dovo-Server-Nightly-0.0.7-nightly.78-macos-arm64.tar.gz"
      sha256 "cab3deb1e7486ac75c40db2ec075c5f012216b12e371844efd4926e79e7fd890"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.78/Dovo-Server-Nightly-0.0.7-nightly.78-linux-arm64.tar.gz"
      sha256 "1b6d0cad007d691fc9c0b60157c3f75ace929165f423d5ba7bffad9f901c2d9f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.78/Dovo-Server-Nightly-0.0.7-nightly.78-linux-x64.tar.gz"
      sha256 "b7d4ab61eb21468d4b09e3727e026df182d9ee4b0b6956086887e352fc6ef161"
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
