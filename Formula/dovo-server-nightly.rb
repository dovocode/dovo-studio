class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1092"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1092/Dovo-Server-Nightly-0.0.9-nightly.1092-macos-arm64.tar.gz"
      sha256 "4af4e4c480b6452c4000e613cfe96a4ab9fb3d6d17485e6f03334a608502f74b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1092/Dovo-Server-Nightly-0.0.9-nightly.1092-linux-arm64.tar.gz"
      sha256 "6965e52b3a87c701afbb42c687b2b89c2fe2a5a451a350ac60784185825f81fe"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1092/Dovo-Server-Nightly-0.0.9-nightly.1092-linux-x64.tar.gz"
      sha256 "ad8bfefd37a2bfd56197a9bb56e24ec693708ac268a77890a7fcb90ac6d4bf51"
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
