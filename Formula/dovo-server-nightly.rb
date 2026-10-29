class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.579"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.579/Dovo-Server-Nightly-0.0.9-nightly.579-macos-arm64.tar.gz"
      sha256 "2b3d678ab8b45bf2d2957fd0f071039a5e3c2cc3a5a7c5a780fae7f52e2ac066"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.579/Dovo-Server-Nightly-0.0.9-nightly.579-linux-arm64.tar.gz"
      sha256 "519d5d3cbc3d408dce0881fe42a638f1c741e8b1170c58caca4b07d79bd17081"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.579/Dovo-Server-Nightly-0.0.9-nightly.579-linux-x64.tar.gz"
      sha256 "c7bc8d68c723e7aa3fc63729862f9178a6820d56e0d366d1701e87a404724c99"
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
