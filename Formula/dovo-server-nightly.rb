class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.556"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.556/Dovo-Server-Nightly-0.0.9-nightly.556-macos-arm64.tar.gz"
      sha256 "9c062a49eec6cd241ba2bd2fcf1d58095edb3ac354d1c6728dd9be1af4de6262"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.556/Dovo-Server-Nightly-0.0.9-nightly.556-linux-arm64.tar.gz"
      sha256 "07473523edd40942f9d19f9150ad21296198b1433bfd5c8852f04f415db8bd56"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.556/Dovo-Server-Nightly-0.0.9-nightly.556-linux-x64.tar.gz"
      sha256 "c05ef36a5339d38c5f8d6629dc9378503b9414bb967bb23c804a80b985aa9ad7"
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
