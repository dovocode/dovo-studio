class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.369"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.369/Dovo-Server-Nightly-0.0.9-nightly.369-macos-arm64.tar.gz"
      sha256 "b4b0c86f2eb90431ce9c7f80af6c8994a5e87d1ed6a05dd1df6b77673005c89a"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.369/Dovo-Server-Nightly-0.0.9-nightly.369-linux-arm64.tar.gz"
      sha256 "deb8582a21b4fba051b1ba2e411878e5eb83870d76db76b96952cc2e0f9c5388"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.369/Dovo-Server-Nightly-0.0.9-nightly.369-linux-x64.tar.gz"
      sha256 "5981d86482d6730c8a66a052e31c3ee7baf216103cbe6385579202e28a400622"
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
