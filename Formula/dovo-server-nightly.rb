class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.474"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.474/Dovo-Server-Nightly-0.0.9-nightly.474-macos-arm64.tar.gz"
      sha256 "1319d491712adcd065e7e8f4e10977d9d39d401bae08eb4c8c79c8f344e5cda0"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.474/Dovo-Server-Nightly-0.0.9-nightly.474-linux-arm64.tar.gz"
      sha256 "6273c6519a8e82ecf99dc1e51d8038c50c73e06968fc29a5f562445517eb328d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.474/Dovo-Server-Nightly-0.0.9-nightly.474-linux-x64.tar.gz"
      sha256 "5ca306ba2e1ab4333bcb01570e6c723a00f0a7eee1c08ecb2d7a2155a76ad5bf"
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
