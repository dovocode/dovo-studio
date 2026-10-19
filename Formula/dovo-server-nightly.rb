class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.395"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.395/Dovo-Server-Nightly-0.0.9-nightly.395-macos-arm64.tar.gz"
      sha256 "47d311fabf00472d8dcf8923fa101a15a21f9e842e10ccb7198fd156875b7c6e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.395/Dovo-Server-Nightly-0.0.9-nightly.395-linux-arm64.tar.gz"
      sha256 "5c587783cfe02dda36d706413ccd697d0f46676ec2d20cddf3dbb6f4eb7cfd09"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.395/Dovo-Server-Nightly-0.0.9-nightly.395-linux-x64.tar.gz"
      sha256 "903a349294526cd836da82033b9ef5b405230cd0b26ffcee0948a10c5b528338"
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
