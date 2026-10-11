class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.275"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.275/Dovo-Server-Nightly-0.0.9-nightly.275-macos-arm64.tar.gz"
      sha256 "46efe6318878553cc0d5e422799dd71c379b802eea9e72c38b955585b49ed095"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.275/Dovo-Server-Nightly-0.0.9-nightly.275-linux-arm64.tar.gz"
      sha256 "5f31f9f70337a4705d815f1b7c6311570431b7f08d540663765ab55f6bf65a81"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.275/Dovo-Server-Nightly-0.0.9-nightly.275-linux-x64.tar.gz"
      sha256 "0269706f4f87a3ef18d4a5e203e2b9f6fd760f3ddd82fbdece6d5ca05c36347e"
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
