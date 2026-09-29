class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.43"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.43/Dovo-Server-Nightly-0.0.7-nightly.43-macos-arm64.tar.gz"
      sha256 "662b71577352ecd0545295cb5936815a049bb626544860818ed3b240bbc3a958"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.43/Dovo-Server-Nightly-0.0.7-nightly.43-linux-arm64.tar.gz"
      sha256 "19fa1703e1919a30222b97f4cdef3e161aca0bf9edd08bbe81be5a9140b2a926"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.43/Dovo-Server-Nightly-0.0.7-nightly.43-linux-x64.tar.gz"
      sha256 "7dff1b4c70d1403cf2e5066b8947c5e9110c0a7f9d9e33217296e938dab6d9bc"
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
