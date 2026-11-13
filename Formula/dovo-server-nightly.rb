class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.847"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.847/Dovo-Server-Nightly-0.0.9-nightly.847-macos-arm64.tar.gz"
      sha256 "867cd8b6e0194b2ae0ea8e8a1b91e20ea8971fb6fa6d0f9e2197ffa7ddb04031"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.847/Dovo-Server-Nightly-0.0.9-nightly.847-linux-arm64.tar.gz"
      sha256 "3f386a54b0793f5b416c225c12d3a90a7331529bbedafdd56c069c27a01f0964"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.847/Dovo-Server-Nightly-0.0.9-nightly.847-linux-x64.tar.gz"
      sha256 "561a9f06b4f8ab8dd327394d98eac070d65394bf9747a0310d94d569a622ba99"
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
