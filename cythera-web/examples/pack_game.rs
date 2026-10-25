//! pack_game <archive.sit> <out.kpk>: the game's StuffIt archive as the
//! fork's web pack, every file's forks uncompressed, which `load_game` reads
//! as it reads the archive. board-native/build.sh swaps a patched program
//! into it (board-native/swap_program.py).
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: pack_game <archive.sit> <out.kpk>");
        std::process::exit(2);
    }
    let sit = std::fs::read(&args[1]).expect("read the archive");
    let pack = systemless::game::pack_stuffit_for_web(&sit).expect("pack the archive");
    std::fs::write(&args[2], pack).expect("write the pack");
}
