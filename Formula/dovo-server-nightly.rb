class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.871"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.871/Dovo-Server-Nightly-0.0.9-nightly.871-macos-arm64.tar.gz"
      sha256 "e0c5699c7c0becd53be77bb1a9c16bbbce47ce48d24b08b7cbd45a8ccd177a2f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.871/Dovo-Server-Nightly-0.0.9-nightly.871-linux-arm64.tar.gz"
      sha256 "edbcc7b51e89ef821bcbbb04ba9fd78d8db3b1703d0924898068b49f36d17f3d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.871/Dovo-Server-Nightly-0.0.9-nightly.871-linux-x64.tar.gz"
      sha256 "b50c1b38401ba3ac3d25024763934d7412b39692c60c2bd1acf25d618fe455cc"
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
