{
  description = "GalMail reproducible development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          bunArchives = {
            aarch64-darwin = {
              archive = "bun-darwin-aarch64";
              hash = "1zbnjc64av5jd09x1bk5ck8pv1vf4siy0xzsww6h1696kah76lzf";
            };
            aarch64-linux = {
              archive = "bun-linux-aarch64";
              hash = "0x8qipcbbn5n3czzzmfn7ci8agxya0gav51kg1jdq84nxfdn4sxj";
            };
            x86_64-linux = {
              archive = "bun-linux-x64";
              hash = "189kasncnfpq6q37q3w80dv2a92w79w20x2x6hf1fbkir5gyvzlb";
            };
          };
          selected = bunArchives.${system};
        in {
          bun = pkgs.stdenvNoCC.mkDerivation {
            pname = "bun";
            version = "1.3.14";
            src = pkgs.fetchzip {
              url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/${selected.archive}.zip";
              sha256 = selected.hash;
            };
            nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
              pkgs.autoPatchelfHook
            ];
            buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
              pkgs.stdenv.cc.cc.lib
            ];
            installPhase = ''
              runHook preInstall
              install -Dm755 bun "$out/bin/bun"
              ln -s bun "$out/bin/bunx"
              runHook postInstall
            '';
            meta.mainProgram = "bun";
          };
          default = self.packages.${system}.bun;
        });

      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          linuxTauriPackages = with pkgs; [
            gtk3
            libsoup_3
            webkitgtk_4_1
          ];
          darwinBuildPackages = with pkgs; [
            libiconv
            xcbuild
          ];
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              self.packages.${system}.bun
              cargo
              clippy
              openssl
              pkg-config
              rust-analyzer
              rustc
              rustfmt
            ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux linuxTauriPackages
              ++ pkgs.lib.optionals pkgs.stdenv.isDarwin darwinBuildPackages;

            shellHook = ''
              test "$(bun --version)" = "1.3.14"
              echo "GalMail shell: Bun $(bun --version), Rust $(rustc --version)"
            '';
          };
        });
    };
}
