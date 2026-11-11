class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.810"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.810/Dovo-Server-Nightly-0.0.9-nightly.810-macos-arm64.tar.gz"
      sha256 "cca27a3fdf7b043a8f481d6477e6f4834fd23c00fa3748f58f52243b0a06417f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.810/Dovo-Server-Nightly-0.0.9-nightly.810-linux-arm64.tar.gz"
      sha256 "4e2f22b51ab6c8208286a6f20e175d67944bfce71cb61970b429c47b9d5d73d1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.810/Dovo-Server-Nightly-0.0.9-nightly.810-linux-x64.tar.gz"
      sha256 "69dff2b0f28c6e7b420679b9a2969647a2a011080868bccc831bfedd242243fb"
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
