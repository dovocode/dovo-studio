class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.441"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.441/Dovo-Server-Nightly-0.0.9-nightly.441-macos-arm64.tar.gz"
      sha256 "b573bad98fa849d23d53b066e43266a4b811b5c3bc28286903325d3a20c99056"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.441/Dovo-Server-Nightly-0.0.9-nightly.441-linux-arm64.tar.gz"
      sha256 "2c2407928bc4fd10cafa2461b5814078002e9cd5e11f030a748586c012a26103"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.441/Dovo-Server-Nightly-0.0.9-nightly.441-linux-x64.tar.gz"
      sha256 "fff64080863704896cfd375bab50cbead8f73e231fe399005c98ae0a58c92cfe"
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
