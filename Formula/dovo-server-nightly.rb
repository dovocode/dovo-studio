class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.281"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.281/Dovo-Server-Nightly-0.0.9-nightly.281-macos-arm64.tar.gz"
      sha256 "1007257e67edceaeb29babc5ce3b13e99ef1e8e499f9a75afcf99cb4d20425fc"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.281/Dovo-Server-Nightly-0.0.9-nightly.281-linux-arm64.tar.gz"
      sha256 "c65ef8d996a95fe6f5276a0f7c1b2254212e40a7ab6f5356e9d529f3da402220"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.281/Dovo-Server-Nightly-0.0.9-nightly.281-linux-x64.tar.gz"
      sha256 "d71e670538870a9c6531fd4ef02facedd3e4fa3f6e68f65d063d0dfcfe173b68"
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
