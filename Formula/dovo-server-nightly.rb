class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.244"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.244/Dovo-Server-Nightly-0.0.9-nightly.244-macos-arm64.tar.gz"
      sha256 "bd929a5b704b8ffb4ac064f665fff9f469e0aa8b82255d96086911252ebc883f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.244/Dovo-Server-Nightly-0.0.9-nightly.244-linux-arm64.tar.gz"
      sha256 "8ee602916ecae85d31503d69cca20912c8a50e192538a243b172848962c8da22"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.244/Dovo-Server-Nightly-0.0.9-nightly.244-linux-x64.tar.gz"
      sha256 "43fececddc3aadf3fe9d8e84959c64c17b1bb9165c58bebbd74137434ecb4007"
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
