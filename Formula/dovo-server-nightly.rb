class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1028"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1028/Dovo-Server-Nightly-0.0.9-nightly.1028-macos-arm64.tar.gz"
      sha256 "a50016ef01298566637664eef4aae87f8222912bff33c88b07c7890cb222ab03"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1028/Dovo-Server-Nightly-0.0.9-nightly.1028-linux-arm64.tar.gz"
      sha256 "fabec180e44ebcb0f7bb37a2ec5a99cb3e3352185acfde1f30a36483bc34d7dd"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1028/Dovo-Server-Nightly-0.0.9-nightly.1028-linux-x64.tar.gz"
      sha256 "f81ef0445abc1acf174852ec8f940737bce32e374922b7f9457d6379af42afd9"
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
