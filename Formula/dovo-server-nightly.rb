class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.235"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.235/Dovo-Server-Nightly-0.0.9-nightly.235-macos-arm64.tar.gz"
      sha256 "8e0e88fb28166fc07ddb20328cfd97a686f9ab0fc34291d16932f30e09e797ea"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.235/Dovo-Server-Nightly-0.0.9-nightly.235-linux-arm64.tar.gz"
      sha256 "15f452877ab0452fd41225557f62d6ce3f5f8e39f55415eb6d5b0553bebb222e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.235/Dovo-Server-Nightly-0.0.9-nightly.235-linux-x64.tar.gz"
      sha256 "8a7c76854246c31e8b67f7da93904db4565aa0cb6ab9b50cd53a60dd0305d821"
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
