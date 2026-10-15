class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.342"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.342/Dovo-Server-Nightly-0.0.9-nightly.342-macos-arm64.tar.gz"
      sha256 "3f88913cf328b357915b871f11bff8e4674f70d0250b62cf2fa43bb865c0d152"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.342/Dovo-Server-Nightly-0.0.9-nightly.342-linux-arm64.tar.gz"
      sha256 "0e349e6b39423345b61cf91996aef929b5fef9cc45d2423eec362d55a9b5b7e5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.342/Dovo-Server-Nightly-0.0.9-nightly.342-linux-x64.tar.gz"
      sha256 "319969ab2c1f730fcca6cd2ca1ac25c5c530d26f4657e68984e3c8022bc46597"
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
