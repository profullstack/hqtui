use hqtui::layout::{distribute, Justify};

fn main() {
    let modes = [
        "start", "end", "center", "space-between", "space-around", "space-evenly",
    ];
    for m in modes {
        for count in 1..=5usize {
            for slack in 0..=12usize {
                let (lead, seams) = distribute(slack, count, Justify::parse(m));
                let parts: Vec<String> = seams.iter().map(|s| s.to_string()).collect();
                println!("{m} {count} {slack} {lead} {}", parts.join(","));
            }
        }
    }
}
