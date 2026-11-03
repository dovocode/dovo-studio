class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.670"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.670/Dovo-Server-Nightly-0.0.9-nightly.670-macos-arm64.tar.gz"
      sha256 "e43bc4b6ce8f4bf91f57523892dbe72b4d9832c189f60662c6c37a604372a7b0"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.670/Dovo-Server-Nightly-0.0.9-nightly.670-linux-arm64.tar.gz"
      sha256 "290d964eede5e0229dd7afc8a24bd5c3428a216c3705fa834b36e90153dcbbe5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.670/Dovo-Server-Nightly-0.0.9-nightly.670-linux-x64.tar.gz"
      sha256 "937a30c96e1a9a5afea99cc45208117476696961c1b3117d580cd145a6a67de4"
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
