class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.581"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.581/Dovo-Server-Nightly-0.0.9-nightly.581-macos-arm64.tar.gz"
      sha256 "81acc0b8fa6f9cba266d47e3d63f438cbc38047a62244e53f49178c234db1a98"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.581/Dovo-Server-Nightly-0.0.9-nightly.581-linux-arm64.tar.gz"
      sha256 "f3763a6588f33c42f35eaed1666bfcdc69619c7418f63ad3c2a7546128916e4c"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.581/Dovo-Server-Nightly-0.0.9-nightly.581-linux-x64.tar.gz"
      sha256 "652cceff79bf2bbf0153bc58b214b9b3f1e0de6d60de7e330a42bd1500b8158a"
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
