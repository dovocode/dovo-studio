class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.857"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.857/Dovo-Server-Nightly-0.0.9-nightly.857-macos-arm64.tar.gz"
      sha256 "6eb760e4eed0a5e64bb3c74f77b341410e54e75980aca4b5dede8c5e7571bed9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.857/Dovo-Server-Nightly-0.0.9-nightly.857-linux-arm64.tar.gz"
      sha256 "20736f3416c9de6e1594bf5867e8939882e9a0bceae3aef1c489aa2fdf9c56b9"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.857/Dovo-Server-Nightly-0.0.9-nightly.857-linux-x64.tar.gz"
      sha256 "6c7078beeabab2df7ec368b912944060d26220602e3cbc8e9e96a9a0b71f9f82"
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
