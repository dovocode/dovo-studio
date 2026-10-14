class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.319"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.319/Dovo-Server-Nightly-0.0.9-nightly.319-macos-arm64.tar.gz"
      sha256 "1e2a145484c040af17de897ebebd9a8febf6221c2bd695a67d0cf90ae9770c64"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.319/Dovo-Server-Nightly-0.0.9-nightly.319-linux-arm64.tar.gz"
      sha256 "5c731f2f8003cbab3fb8f9a9b04f11c313c490314aca9aeab7b9a303cd091f68"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.319/Dovo-Server-Nightly-0.0.9-nightly.319-linux-x64.tar.gz"
      sha256 "94fcf3e05e631d9d455a7e2bbc256495348e4e70a829d1b7d9a59eefc7bb00eb"
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
