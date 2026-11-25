class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1104"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1104/Dovo-Server-Nightly-0.0.9-nightly.1104-macos-arm64.tar.gz"
      sha256 "f726c87aa55072cf1ca903781e962eea02e81626e9e603a65a85e6ee60269d8f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1104/Dovo-Server-Nightly-0.0.9-nightly.1104-linux-arm64.tar.gz"
      sha256 "dbf5ddc0918d7590c6eee9bd08c9b424ae9b0d46df8fc6daa28e972c5db98397"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1104/Dovo-Server-Nightly-0.0.9-nightly.1104-linux-x64.tar.gz"
      sha256 "92e4c7c7310c5ba8e990eadff2e694f07e805bfd1fc66215f43fb8c1ad9e005f"
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
