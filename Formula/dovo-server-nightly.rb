class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.344"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.344/Dovo-Server-Nightly-0.0.9-nightly.344-macos-arm64.tar.gz"
      sha256 "cd8e11595cb8d35ca64b32af8ad34701699c18a2c16b01438615f771ec2201b4"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.344/Dovo-Server-Nightly-0.0.9-nightly.344-linux-arm64.tar.gz"
      sha256 "d29d38518e1d6ec0d12315137b07886af156f0f9e79087031cd87698d7a2f939"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.344/Dovo-Server-Nightly-0.0.9-nightly.344-linux-x64.tar.gz"
      sha256 "3b075049d8b0f3adf8faf2c8b0443430e8311b85fa3dc89945c1f77138041ac9"
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
