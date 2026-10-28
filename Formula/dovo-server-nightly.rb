class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.560"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.560/Dovo-Server-Nightly-0.0.9-nightly.560-macos-arm64.tar.gz"
      sha256 "941fb66838955d320945266a62439b0998869e76b2ea8ec3efa7dbb5b8d5dbcb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.560/Dovo-Server-Nightly-0.0.9-nightly.560-linux-arm64.tar.gz"
      sha256 "ae2ec1ee17dd5ef1d4882906dd4c265c355b78e397670de04039348cbeaa5e63"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.560/Dovo-Server-Nightly-0.0.9-nightly.560-linux-x64.tar.gz"
      sha256 "5fb613b085d95a8a4fe2e52130fe82fa0b9bb9fa2e9ae98da2107696ffd3fb8d"
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
