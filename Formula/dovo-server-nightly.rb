class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.394"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.394/Dovo-Server-Nightly-0.0.9-nightly.394-macos-arm64.tar.gz"
      sha256 "9d1403438e1d3e76a268d9cb5324e6506b519e46e2452ea2aa3e01f9fc98e24e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.394/Dovo-Server-Nightly-0.0.9-nightly.394-linux-arm64.tar.gz"
      sha256 "26ae797b225bf42d5a08feff87fcf774426ac6acc3017c694c3fc9a753872d13"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.394/Dovo-Server-Nightly-0.0.9-nightly.394-linux-x64.tar.gz"
      sha256 "88209c832bd19b664d6a48e1a741864f8b8939fc203014d35227b674e5980688"
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
