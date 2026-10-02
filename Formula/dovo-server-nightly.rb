class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.162"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.162/Dovo-Server-Nightly-0.0.7-nightly.162-macos-arm64.tar.gz"
      sha256 "1c331bf41b61910c635e560c4c57d2144eafac883c4be35f6cef5d7a4e02f720"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.162/Dovo-Server-Nightly-0.0.7-nightly.162-linux-arm64.tar.gz"
      sha256 "5acfff28960f143bdfec077857c32583d0deafb693603a83b4962b153469136d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.162/Dovo-Server-Nightly-0.0.7-nightly.162-linux-x64.tar.gz"
      sha256 "cc3049dbe5921fd24999c9527af936bc0568aabd155fb3ab68c352b35bf78ddd"
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
