class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.718"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.718/Dovo-Server-Nightly-0.0.9-nightly.718-macos-arm64.tar.gz"
      sha256 "6eb3810a7ebf37580e3952cb2b35019375ed2f0bec799fb7e7fca3e8a511d5b8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.718/Dovo-Server-Nightly-0.0.9-nightly.718-linux-arm64.tar.gz"
      sha256 "2ca5be2fc424f1c1245e5cb236f6bf0789733c00c3ebd4c288bf70800ab33b20"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.718/Dovo-Server-Nightly-0.0.9-nightly.718-linux-x64.tar.gz"
      sha256 "20c0eab5a87b7525dfce260a9144bf2e1dbb4662af36e48316bb07bc075872b0"
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
