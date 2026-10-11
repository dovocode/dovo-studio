class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.283"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.283/Dovo-Server-Nightly-0.0.9-nightly.283-macos-arm64.tar.gz"
      sha256 "22b7ce95462da2d223d701d9e207c0ca5e2aecf6d699d3ac5ba12c4cd5af4489"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.283/Dovo-Server-Nightly-0.0.9-nightly.283-linux-arm64.tar.gz"
      sha256 "ef30e9de00622a5f5a6321bdbd114fefa455707f1a10ed20045e557722810a16"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.283/Dovo-Server-Nightly-0.0.9-nightly.283-linux-x64.tar.gz"
      sha256 "700c74df748df95c06e3f32e8030edeb1accef8ef1d365d22cd8f411b9b09e18"
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
