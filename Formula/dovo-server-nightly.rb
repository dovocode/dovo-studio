class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.469"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.469/Dovo-Server-Nightly-0.0.9-nightly.469-macos-arm64.tar.gz"
      sha256 "3c77f6dc2fe72e943e610d16a811da2407eeeea59a92e77dcc1dba71667bb37c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.469/Dovo-Server-Nightly-0.0.9-nightly.469-linux-arm64.tar.gz"
      sha256 "bdf9e4953b6b6fe0718c8a7dc5dd945b7dff28aa930db0af39321cf66a8f319d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.469/Dovo-Server-Nightly-0.0.9-nightly.469-linux-x64.tar.gz"
      sha256 "055f1c872036560468ae18b9ab1957a7c74a3374a86d51183a50bab2db507425"
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
