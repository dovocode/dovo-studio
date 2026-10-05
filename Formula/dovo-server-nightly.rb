class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.228"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.228/Dovo-Server-Nightly-0.0.9-nightly.228-macos-arm64.tar.gz"
      sha256 "3eae4aca4dbce7a675723dc481cca1180242d899922eb8876433b69e91988275"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.228/Dovo-Server-Nightly-0.0.9-nightly.228-linux-arm64.tar.gz"
      sha256 "7c76d99ebb9056f323f4482bbdc0a6661142f473c19c7d3db5b89de331b955a3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.228/Dovo-Server-Nightly-0.0.9-nightly.228-linux-x64.tar.gz"
      sha256 "673d9a132212fe886b62772f0581d432b9be4299c4e6e82392576becbade8d80"
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
