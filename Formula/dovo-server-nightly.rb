class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.755"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.755/Dovo-Server-Nightly-0.0.9-nightly.755-macos-arm64.tar.gz"
      sha256 "cf4cf290b98996dfb9f3a7412050f81a9df961289cdd058e3615745d4706ded5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.755/Dovo-Server-Nightly-0.0.9-nightly.755-linux-arm64.tar.gz"
      sha256 "92651b456c98de5c6521aeaab0107707599bc74d1e1e47eec23d29d8b9ba8960"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.755/Dovo-Server-Nightly-0.0.9-nightly.755-linux-x64.tar.gz"
      sha256 "775672b7982111a65dccf9e05fa6fee85f0b30bea301233d602e57a410f12892"
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
