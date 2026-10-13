class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.307"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.307/Dovo-Server-Nightly-0.0.9-nightly.307-macos-arm64.tar.gz"
      sha256 "5a6b2f8e5a489b8eaf019f11974cb986e6bea788b98ace86135ccd2e4f2548f9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.307/Dovo-Server-Nightly-0.0.9-nightly.307-linux-arm64.tar.gz"
      sha256 "26348e9067ad906421ecd6b5c85cd392bcf43061b289d956f9d128d8813ed9ea"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.307/Dovo-Server-Nightly-0.0.9-nightly.307-linux-x64.tar.gz"
      sha256 "f647e0e26548e357c2edfb9525ec536d78baab3f4f3723526e9623ca6de5f5f5"
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
