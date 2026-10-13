class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.305"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.305/Dovo-Server-Nightly-0.0.9-nightly.305-macos-arm64.tar.gz"
      sha256 "0846f0038deea21236e55a75c3007057b384102b68569799d9255404df48147e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.305/Dovo-Server-Nightly-0.0.9-nightly.305-linux-arm64.tar.gz"
      sha256 "59523c1f29673bc13ad0b889ed855ebe1a00e5b7db1438ec485375381dfdff9d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.305/Dovo-Server-Nightly-0.0.9-nightly.305-linux-x64.tar.gz"
      sha256 "eef1445e01c2d432644c3fcb1dbb90f32ea03fedd4da68fe3e1ebbe0f774900d"
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
