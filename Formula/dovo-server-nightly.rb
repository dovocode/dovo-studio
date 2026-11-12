class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.825"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.825/Dovo-Server-Nightly-0.0.9-nightly.825-macos-arm64.tar.gz"
      sha256 "fd3a7970b76f4df92008cae2922162a7472f71b9702c279908396ec7b66a5319"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.825/Dovo-Server-Nightly-0.0.9-nightly.825-linux-arm64.tar.gz"
      sha256 "9275260f9bf30090af627d7f9fabb05ef6e3586d13edeac57af648d925954a66"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.825/Dovo-Server-Nightly-0.0.9-nightly.825-linux-x64.tar.gz"
      sha256 "6fbc2a6a043283262bf8bc00b804bf60aa5ef968c0b33c931239c5e7e29ca121"
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
