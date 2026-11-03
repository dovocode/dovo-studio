class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.676"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.676/Dovo-Server-Nightly-0.0.9-nightly.676-macos-arm64.tar.gz"
      sha256 "26775fa63e909c9431f788f8baea2343177c7855eeffb9f5638f5a9a397503a9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.676/Dovo-Server-Nightly-0.0.9-nightly.676-linux-arm64.tar.gz"
      sha256 "709ea9a6b15a919c9161f13ea93c32a2c2eef220c5b572e9a3172a5ad6a42c85"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.676/Dovo-Server-Nightly-0.0.9-nightly.676-linux-x64.tar.gz"
      sha256 "e66e05958da393d5633b67217e021d864e51dec13dca36b24d3c7cee49ef3fb9"
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
