class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.60"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.60/Dovo-Server-Nightly-0.0.7-nightly.60-macos-arm64.tar.gz"
      sha256 "c966c9e9330bb05579034bdd218b63548d0db3c5b1384b62c0d493fb36c0fd55"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.60/Dovo-Server-Nightly-0.0.7-nightly.60-linux-arm64.tar.gz"
      sha256 "656d7b875fc23f12ca2a46ea2c6c78d43a40435162d5579abc05eab5b93310d5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.60/Dovo-Server-Nightly-0.0.7-nightly.60-linux-x64.tar.gz"
      sha256 "671e83a57caeaa758aee50d9be58643f081d0f0515ff666d54e8116127d18d85"
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
