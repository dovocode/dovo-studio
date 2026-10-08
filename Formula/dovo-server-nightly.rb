class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.252"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.252/Dovo-Server-Nightly-0.0.9-nightly.252-macos-arm64.tar.gz"
      sha256 "3ea9185b7e014873da0902e78c4b4f18de3d503e441e4d9e6f7712e631b60598"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.252/Dovo-Server-Nightly-0.0.9-nightly.252-linux-arm64.tar.gz"
      sha256 "5ac4ca76482aecb1eaf76a1b7a57a8a1acc1e22b32e01ba777441ee76b74292a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.252/Dovo-Server-Nightly-0.0.9-nightly.252-linux-x64.tar.gz"
      sha256 "ecdf920ac32361d1098845363ca548a24a15edf848a7ce81d9810398cb4859c5"
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
