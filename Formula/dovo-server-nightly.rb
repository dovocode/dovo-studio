class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.366"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.366/Dovo-Server-Nightly-0.0.9-nightly.366-macos-arm64.tar.gz"
      sha256 "ba7e578980ae980a491c854d0180e7d3cdb6902c48c246636265bb256d88a015"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.366/Dovo-Server-Nightly-0.0.9-nightly.366-linux-arm64.tar.gz"
      sha256 "dca94ff14886a969540ff2c31a4b0a0bb7f24502372a3bbe945a71fa4a647325"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.366/Dovo-Server-Nightly-0.0.9-nightly.366-linux-x64.tar.gz"
      sha256 "c5b9d9a0ceaf447914fd91e8f790416465b27938574bcbf4745261ec93ffeaaa"
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
